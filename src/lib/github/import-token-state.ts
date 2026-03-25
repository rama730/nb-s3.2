import type { SealedImportToken } from "@/lib/github/repo-security";

function isNullish(input: unknown) {
  return input === null || input === undefined;
}

function normalizeSealedImportToken(input: unknown): SealedImportToken | null {
  if (!input || typeof input !== "object") return null;
  const token = input as Partial<SealedImportToken>;
  if (
    token.v !== "v1" ||
    typeof token.iv !== "string" ||
    typeof token.ciphertext !== "string" ||
    typeof token.authTag !== "string" ||
    typeof token.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    v: "v1",
    iv: token.iv,
    ciphertext: token.ciphertext,
    authTag: token.authTag,
    expiresAt: token.expiresAt,
  };
}

export function getSealedImportTokenFingerprint(input: unknown): string {
  const token = normalizeSealedImportToken(input);
  if (!token) return "";
  return `${token.iv}:${token.ciphertext}:${token.authTag}:${token.expiresAt}`;
}

export function areSealedImportTokensEqual(a: unknown, b: unknown): boolean {
  if (isNullish(a) || isNullish(b)) {
    return isNullish(a) && isNullish(b);
  }
  return getSealedImportTokenFingerprint(a) === getSealedImportTokenFingerprint(b);
}
