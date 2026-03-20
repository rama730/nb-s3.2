import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type StoredRecoveryCode = {
  id: string;
  salt: string;
  hash: string;
  usedAt: string | null;
};

const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_SEGMENT_LENGTH = 4;
const RECOVERY_CODE_SEGMENT_COUNT = 2;
const DEFAULT_RECOVERY_CODE_COUNT = 10;

function resolveRecoveryCodeSecret(): string {
  const secret = process.env.SECURITY_RECOVERY_CODE_SECRET
    ?? process.env.SECURITY_STEPUP_SECRET
    ?? process.env.SUPABASE_JWT_SECRET
    ?? "";

  if (!secret.trim()) {
    throw new Error("Missing SECURITY_RECOVERY_CODE_SECRET and SUPABASE_JWT_SECRET");
  }

  return secret;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function generateRecoveryCodeValue(): string {
  const chars: string[] = [];
  const totalChars = RECOVERY_CODE_SEGMENT_LENGTH * RECOVERY_CODE_SEGMENT_COUNT;
  const bytes = randomBytes(totalChars);

  for (let index = 0; index < totalChars; index += 1) {
    chars.push(RECOVERY_CODE_ALPHABET[bytes[index]! % RECOVERY_CODE_ALPHABET.length]!);
  }

  return `${chars.slice(0, RECOVERY_CODE_SEGMENT_LENGTH).join("")}-${chars
    .slice(RECOVERY_CODE_SEGMENT_LENGTH)
    .join("")}`;
}

export function normalizeRecoveryCodeInput(code: string | null | undefined): string {
  return typeof code === "string"
    ? code.toUpperCase().replace(/[^A-Z0-9]/gu, "")
    : "";
}

function hashRecoveryCode(normalizedCode: string, salt: string): string {
  return createHmac("sha256", resolveRecoveryCodeSecret())
    .update(`${salt}:${normalizedCode}`)
    .digest("hex");
}

export function parseStoredRecoveryCodes(value: unknown): StoredRecoveryCode[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is StoredRecoveryCode => (
      !!entry
      && typeof entry === "object"
      && typeof (entry as StoredRecoveryCode).id === "string"
      && typeof (entry as StoredRecoveryCode).salt === "string"
      && typeof (entry as StoredRecoveryCode).hash === "string"
      && (
        (entry as StoredRecoveryCode).usedAt === null
        || typeof (entry as StoredRecoveryCode).usedAt === "string"
      )
    ))
    .map((entry) => ({
      id: entry.id,
      salt: entry.salt,
      hash: entry.hash,
      usedAt: entry.usedAt,
    }));
}

export function countRemainingRecoveryCodes(codes: StoredRecoveryCode[]): number {
  return codes.reduce((count, code) => count + (code.usedAt ? 0 : 1), 0);
}

export function generateRecoveryCodes(count: number = DEFAULT_RECOVERY_CODE_COUNT): {
  codes: string[];
  storedCodes: StoredRecoveryCode[];
  generatedAt: string;
} {
  const codes: string[] = [];
  const storedCodes: StoredRecoveryCode[] = [];
  const generatedAt = new Date().toISOString();

  for (let index = 0; index < count; index += 1) {
    const code = generateRecoveryCodeValue();
    const salt = toBase64Url(randomBytes(12));
    codes.push(code);
    storedCodes.push({
      id: crypto.randomUUID(),
      salt,
      hash: hashRecoveryCode(normalizeRecoveryCodeInput(code), salt),
      usedAt: null,
    });
  }

  return { codes, storedCodes, generatedAt };
}

export function consumeRecoveryCode(
  codes: StoredRecoveryCode[],
  rawCode: string,
): {
  matched: boolean;
  updatedCodes: StoredRecoveryCode[];
  remainingCount: number;
} {
  const normalizedCode = normalizeRecoveryCodeInput(rawCode);
  if (!normalizedCode) {
    return {
      matched: false,
      updatedCodes: codes,
      remainingCount: countRemainingRecoveryCodes(codes),
    };
  }

  const updatedCodes = codes.map((entry) => ({ ...entry }));
  let matchedIndex = -1;

  for (let index = 0; index < updatedCodes.length; index += 1) {
    const entry = updatedCodes[index]!;
    if (entry.usedAt) continue;

    const expected = Buffer.from(entry.hash, "hex");
    const actual = Buffer.from(hashRecoveryCode(normalizedCode, entry.salt), "hex");
    if (expected.length !== actual.length) continue;
    if (timingSafeEqual(expected, actual)) {
      matchedIndex = index;
      break;
    }
  }

  if (matchedIndex === -1) {
    return {
      matched: false,
      updatedCodes: codes,
      remainingCount: countRemainingRecoveryCodes(codes),
    };
  }

  updatedCodes[matchedIndex] = {
    ...updatedCodes[matchedIndex]!,
    usedAt: new Date().toISOString(),
  };

  return {
    matched: true,
    updatedCodes,
    remainingCount: countRemainingRecoveryCodes(updatedCodes),
  };
}
