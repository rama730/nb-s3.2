type ImportSourceKind = "github" | "upload" | "scratch" | "system";

const MAX_COMPONENT_LENGTH = 96;

function normalizePathForHash(path: string): string {
  return (path || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
}

export function normalizeImportIdComponent(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) return fallback;
  return normalized.length > MAX_COMPONENT_LENGTH
    ? normalized.slice(0, MAX_COMPONENT_LENGTH)
    : normalized;
}

/**
 * Unified idempotency event ID format across all import sources.
 * Format:
 *   project-import:{projectId}:{source}:{normalizedTarget}:{branchOrManifestHash}
 */
export function buildProjectImportEventId(input: {
  projectId: string;
  source: ImportSourceKind;
  normalizedTarget: string;
  branchOrManifestHash?: string | null;
}): string {
  const projectId = normalizeImportIdComponent(input.projectId, "project");
  const source = normalizeImportIdComponent(input.source, "source");
  const target = normalizeImportIdComponent(input.normalizedTarget, "target");
  const ref = normalizeImportIdComponent(input.branchOrManifestHash || "default", "default");

  return `project-import:${projectId}:${source}:${target}:${ref}`;
}

function fnv1a64(input: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");

  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
}

export type UploadManifestHashEntry = {
  relativePath: string;
  size?: number | null;
  mimeType?: string | null;
};

/**
 * Deterministic manifest hash to support idempotent upload registration.
 */
export function buildUploadManifestHash(entries: UploadManifestHashEntry[]): string {
  const canonical = (entries || [])
    .map((entry) => ({
      relativePath: normalizePathForHash(entry.relativePath),
      size: Number(entry.size || 0),
      mimeType: (entry.mimeType || "application/octet-stream").trim().toLowerCase(),
    }))
    .filter((entry) => entry.relativePath.length > 0)
    .sort((a, b) => {
      if (a.relativePath !== b.relativePath) return a.relativePath.localeCompare(b.relativePath);
      if (a.size !== b.size) return a.size - b.size;
      return a.mimeType.localeCompare(b.mimeType);
    })
    .map((entry) => `${entry.relativePath}:${entry.size}:${entry.mimeType}`)
    .join("|");

  return fnv1a64(canonical || "empty");
}
