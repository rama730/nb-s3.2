import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

export type SecurityStepUpMethod = "totp" | "recovery_code" | "password";

type SecurityStepUpPayload = {
  userId: string;
  method: SecurityStepUpMethod;
  verifiedAt: number;
  exp: number;
};

export const SECURITY_STEP_UP_COOKIE_NAME = "nb-security-stepup";
export const SECURITY_STEP_UP_MAX_AGE_SECONDS = 5 * 60;

function resolveSecurityStepUpSecret(): string {
  const secret = process.env.SECURITY_STEPUP_SECRET ?? "";

  if (!secret.trim()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing SECURITY_STEPUP_SECRET");
    }
    console.warn("[security.step-up] using development fallback step-up secret");
    return "development-security-stepup-secret";
  }

  return secret;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function signPayload(serializedPayload: string): string {
  return createHmac("sha256", resolveSecurityStepUpSecret())
    .update(serializedPayload)
    .digest("base64url");
}

function buildSecurityStepUpValue(payload: SecurityStepUpPayload): string {
  const serializedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(serializedPayload);
  return `${serializedPayload}.${signature}`;
}

function parseSecurityStepUpValue(
  cookieValue: string | null | undefined,
): SecurityStepUpPayload | null {
  if (!cookieValue) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [serializedPayload, signature] = parts;
  if (!serializedPayload || !signature) return null;

  const expectedSignature = Buffer.from(signPayload(serializedPayload));
  const providedSignature = Buffer.from(signature);
  if (expectedSignature.length !== providedSignature.length) return null;
  if (!timingSafeEqual(expectedSignature, providedSignature)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(serializedPayload)) as SecurityStepUpPayload;
    if (
      !payload
      || typeof payload.userId !== "string"
      || (payload.method !== "totp" && payload.method !== "recovery_code" && payload.method !== "password")
      || typeof payload.verifiedAt !== "number"
      || typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function issueSecurityStepUpCookie(
  response: NextResponse,
  userId: string,
  method: SecurityStepUpMethod,
): { verifiedAt: string; expiresAt: string } {
  const verifiedAt = new Date();
  const expiresAt = new Date(verifiedAt.getTime() + SECURITY_STEP_UP_MAX_AGE_SECONDS * 1000);

  const value = buildSecurityStepUpValue({
    userId,
    method,
    verifiedAt: Math.floor(verifiedAt.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  });

  response.cookies.set(SECURITY_STEP_UP_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1",
    maxAge: SECURITY_STEP_UP_MAX_AGE_SECONDS,
  });

  return {
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function clearSecurityStepUpCookie(response: NextResponse) {
  response.cookies.set(SECURITY_STEP_UP_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1",
    maxAge: 0,
  });
}

export async function resolveSecurityStepUp(
  userId: string,
  allowedMethods?: SecurityStepUpMethod[],
): Promise<{
  ok: boolean;
  payload?: SecurityStepUpPayload;
}> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SECURITY_STEP_UP_COOKIE_NAME)?.value ?? null;
  const payload = parseSecurityStepUpValue(cookieValue);
  if (!payload) return { ok: false };
  if (payload.userId !== userId) return { ok: false };
  if (allowedMethods && !allowedMethods.includes(payload.method)) {
    return { ok: false };
  }
  return { ok: true, payload };
}

export const __testOnly = {
  buildSecurityStepUpValue,
  parseSecurityStepUpValue,
};
