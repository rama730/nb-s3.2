import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

import type { SealedImportToken } from "@/lib/github/repo-security";

export const GITHUB_IMPORT_ACCESS_COOKIE = "nb-github-import-access";
const GITHUB_IMPORT_ACCESS_MAX_AGE_SECONDS = 45 * 60;

function encodeCookieValue(sealed: SealedImportToken): string {
  return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
}

function decodeCookieValue(value: string | null | undefined): SealedImportToken | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SealedImportToken;
    if (
      parsed?.v !== "v1" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string" ||
      typeof parsed.authTag !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function setGithubImportAccessCookie(response: NextResponse, sealed: SealedImportToken) {
  response.cookies.set(
    GITHUB_IMPORT_ACCESS_COOKIE,
    encodeCookieValue(sealed),
    cookieOptions(GITHUB_IMPORT_ACCESS_MAX_AGE_SECONDS),
  );
}

export async function persistGithubImportAccessCookie(sealed: SealedImportToken) {
  const cookieStore = await cookies();
  cookieStore.set(
    GITHUB_IMPORT_ACCESS_COOKIE,
    encodeCookieValue(sealed),
    cookieOptions(GITHUB_IMPORT_ACCESS_MAX_AGE_SECONDS),
  );
}

export function clearGithubImportAccessCookie(response: NextResponse) {
  response.cookies.set(
    GITHUB_IMPORT_ACCESS_COOKIE,
    "",
    cookieOptions(0),
  );
}

export async function readGithubImportAccessCookie(): Promise<SealedImportToken | null> {
  const cookieStore = await cookies();
  return decodeCookieValue(cookieStore.get(GITHUB_IMPORT_ACCESS_COOKIE)?.value ?? null);
}
