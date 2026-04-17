import crypto from "crypto";
const IMPORT_TOKEN_TTL_MS = 45 * 60 * 1000;
const GCM_AUTH_TAG_LENGTH_BYTES = 16;
const GCM_IV_LENGTH_BYTES = 12;
export { normalizeGithubBranch, normalizeGithubRepoUrl, isValidGithubBranchName } from "@/lib/github/repo-validation";

export type SealedImportToken = {
  v: "v1";
  iv: string;
  ciphertext: string;
  authTag: string;
  expiresAt: string;
};

function getTokenEncryptionKey(): Buffer | null {
  const raw = process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY ?? "";
  if (!raw) return null;

  try {
    const maybeBase64 = Buffer.from(raw, "base64");
    if (maybeBase64.length >= 32) {
      return crypto.createHash("sha256").update(maybeBase64).digest();
    }
  } catch {
    // fall through
  }

  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function sealGithubImportToken(token: string, ttlMs: number = IMPORT_TOKEN_TTL_MS): SealedImportToken | null {
  if (!token) return null;
  const key = getTokenEncryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(GCM_IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    v: "v1",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: authTag.toString("base64url"),
    expiresAt: new Date(Date.now() + Math.max(60_000, ttlMs)).toISOString(),
  };
}

export function openGithubImportToken(sealed: unknown): string | null {
  if (!sealed || typeof sealed !== "object") return null;
  const payload = sealed as Partial<SealedImportToken>;
  if (payload.v !== "v1" || !payload.iv || !payload.ciphertext || !payload.authTag || !payload.expiresAt) {
    return null;
  }

  if (new Date(payload.expiresAt).getTime() <= Date.now()) return null;

  const key = getTokenEncryptionKey();
  if (!key) return null;

  try {
    const iv = Buffer.from(payload.iv, "base64url");
    const authTag = Buffer.from(payload.authTag, "base64url");
    if (iv.length !== GCM_IV_LENGTH_BYTES || authTag.length !== GCM_AUTH_TAG_LENGTH_BYTES) {
      return null;
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      iv,
      { authTagLength: GCM_AUTH_TAG_LENGTH_BYTES },
    );
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

export function clearSealedGithubTokenFromImportSource(input: unknown) {
  if (!input || typeof input !== "object") return input;
  const src = input as Record<string, unknown>;
  const metadata = (src.metadata && typeof src.metadata === "object")
    ? { ...(src.metadata as Record<string, unknown>) }
    : {};
  delete metadata.importAuth;
  return { ...src, metadata };
}

export function sanitizeGitErrorMessage(raw: unknown): string {
  const input = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
  let out = input;

  // URL credentials e.g. https://token@github.com/owner/repo
  out = out.replace(/https:\/\/[^@\s/]+@github\.com/gi, "https://[REDACTED]@github.com");
  // Authorization headers
  out = out.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi, "Authorization: Basic [REDACTED]");
  out = out.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer [REDACTED]");
  // Common GitHub token shapes
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_TOKEN]");
  // Any explicit importAuth blob reference
  out = out.replace(/"importAuth"\s*:\s*\{[^}]*\}/gi, "\"importAuth\": \"[REDACTED]\"");

  return out.length > 600 ? `${out.slice(0, 600)}...` : out;
}
