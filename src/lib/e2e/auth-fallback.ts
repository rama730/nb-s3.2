import { createHmac, timingSafeEqual } from "node:crypto";

export const E2E_AUTH_COOKIE = "e2e_auth_user_id";

export function isE2EAuthFallbackEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const fallbackEnabled = process.env.E2E_AUTH_FALLBACK === "1";
  if (!fallbackEnabled) return false;
  const isTestHarness =
    process.env.NODE_ENV === "test" ||
    process.env.PLAYWRIGHT_TEST === "1" ||
    process.env.CI_E2E === "1";
  return isTestHarness;
}

// SEC-L10: secondary gate on the E2E auth route.
// Even when the environment-based gate (`isE2EAuthFallbackEnabled`) allows
// the request, we additionally require a valid HMAC signature over
// `timestamp + "\n" + rawBody` when `E2E_AUTH_HMAC_SECRET` is configured.
// The secret is rotated per CI run, so even a leaked CI image cannot
// replay signed requests against other environments. Local dev can omit
// the secret, in which case this gate is a no-op (the env gate is the
// only line of defense, as before).

const E2E_SIGNATURE_HEADER = "x-e2e-signature";
const E2E_TIMESTAMP_HEADER = "x-e2e-timestamp";
const E2E_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export type E2EHmacResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: string };

export function verifyE2EHmac(
  request: Request,
  rawBody: string,
): E2EHmacResult {
  const secret = process.env.E2E_AUTH_HMAC_SECRET?.trim() ?? "";
  if (!secret) {
    // Gate disabled — only the env gate protects the route.
    return { ok: true, skipped: true };
  }

  const timestampHeader = request.headers.get(E2E_TIMESTAMP_HEADER);
  const signatureHeader = request.headers.get(E2E_SIGNATURE_HEADER);
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing_signature_headers" };
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(Date.now() - timestampMs) > E2E_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "timestamp_skewed" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestampHeader}\n${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }
  if (providedBuf.length !== expectedBuf.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true, skipped: false };
}
