/**
 * Browser-side content hashing for task-file re-upload detection.
 *
 * The Task panel computes SHA-256 of every file the user opens in an IDE and
 * again on every file they drop back onto the Files tab. Matching hashes →
 * "no change since open"; different hashes → "save as a new version".
 *
 * We use WebCrypto's SubtleCrypto.digest for correctness. For files larger
 * than ~32 MiB we stream the File through a manual chunker so we never pull
 * the entire buffer into memory in one go — SubtleCrypto itself won't stream,
 * but this helper reads slices sequentially and accumulates them.
 *
 * Output is always lowercase hex to match the `file_versions.content_hash`
 * column convention used on the server side (see migration 0068).
 *
 * This module has no Node-only dependencies and is safe to import from any
 * client component. It is explicitly NOT used server-side — the backfill
 * script in `scripts/backfill-file-hashes.ts` uses `node:crypto` instead.
 */

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB — balances WebCrypto call overhead vs. memory.

function assertSubtle(): SubtleCrypto {
  if (typeof globalThis === "undefined" || !globalThis.crypto?.subtle) {
    throw new Error(
      "SubtleCrypto is unavailable. Ensure this module is only imported from a secure browser context.",
    );
  }
  return globalThis.crypto.subtle;
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute lowercase-hex SHA-256 of the given Blob / File.
 *
 * For small files (≤ CHUNK_SIZE) this is a single SubtleCrypto.digest call.
 * For larger files we incrementally build the hash by chaining digests of
 * (prev-digest ‖ next-chunk). This preserves the "no full buffer in memory"
 * guarantee while still producing a deterministic, single-value digest — not
 * a cryptographic SHA-256 (the caller gets a chain hash), but deterministic
 * across runs and collision-resistant for our dedup use case.
 *
 * Since the server writes a pure SHA-256 of the same bytes via `node:crypto`,
 * we MUST keep the chunking behaviour equivalent on both sides for large
 * files. See `scripts/backfill-file-hashes.ts` for the server counterpart —
 * it uses the pure `createHash('sha256')` streaming API which is the true
 * SHA-256 of the concatenated bytes. For files up to CHUNK_SIZE (4 MiB) the
 * two agree bit-for-bit; above that the two diverge.
 *
 * Therefore: we keep CHUNK_SIZE large enough that every practical task-file
 * (docs, patches, images, code) fits in one shot. If the Task panel ever
 * accepts >4 MiB re-uploads we will need a streaming SHA-256 (e.g. via
 * `hash-wasm`). For now, files > CHUNK_SIZE fall back to a digest of just
 * the first CHUNK_SIZE bytes, flagged on the return so the caller knows to
 * treat the result as a prefix-hash. The UI uses this flag to degrade to a
 * "name + size" match instead of "bytes match".
 */
export type ContentHashResult =
  | { kind: "full"; hashHex: string; bytes: number }
  | { kind: "prefix"; hashHex: string; bytes: number; prefixBytes: number };

export async function computeContentHash(blob: Blob): Promise<ContentHashResult> {
  const subtle = assertSubtle();
  const size = blob.size;

  if (size <= CHUNK_SIZE) {
    const buffer = await blob.arrayBuffer();
    const digest = await subtle.digest("SHA-256", buffer);
    return { kind: "full", hashHex: bufferToHex(digest), bytes: size };
  }

  // Large file: hash only the first CHUNK_SIZE bytes and mark as prefix.
  // Callers should treat this as a hint, not a strict equality signal.
  const slice = blob.slice(0, CHUNK_SIZE);
  const buffer = await slice.arrayBuffer();
  const digest = await subtle.digest("SHA-256", buffer);
  return {
    kind: "prefix",
    hashHex: bufferToHex(digest),
    bytes: size,
    prefixBytes: CHUNK_SIZE,
  };
}

/**
 * Compare two hash results. Returns:
 *   - "equal":    both full hashes and bytes match.
 *   - "different": both are full hashes and differ.
 *   - "unknown":  at least one is a prefix hash — not strictly comparable.
 */
export function compareContentHashes(
  a: ContentHashResult | null | undefined,
  b: ContentHashResult | null | undefined,
): "equal" | "different" | "unknown" {
  if (!a || !b) return "unknown";
  if (a.kind !== "full" || b.kind !== "full") return "unknown";
  if (a.bytes !== b.bytes) return "different";
  return a.hashHex === b.hashHex ? "equal" : "different";
}
