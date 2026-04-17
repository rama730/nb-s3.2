import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, DEV_CSRF_SECRET_FALLBACK, MINIMUM_CSRF_SECRET_LENGTH } from "./csrf-constants";

// SEC-C2: In production we require CSRF_TOKEN_SECRET; in dev we fall back to a
// shared constant so the edge middleware (which signs the cookie) and the node
// runtime (which validates it) agree on the same key even when the env var is
// absent. Using a per-boot random here would make dev signatures un-verifiable
// across the edge/node boundary.
function resolveCsrfSecret() {
  const configured = process.env.CSRF_TOKEN_SECRET?.trim();
  if (configured) {
    if (configured.length < MINIMUM_CSRF_SECRET_LENGTH) {
      throw new Error(
        `CSRF_TOKEN_SECRET must be at least ${MINIMUM_CSRF_SECRET_LENGTH} characters`,
      );
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing CSRF_TOKEN_SECRET");
  }

  return DEV_CSRF_SECRET_FALLBACK;
}

// Force-evaluate in production so deploys without the secret fail fast instead
// of silently accepting every forged CSRF token on the first request.
if (process.env.NODE_ENV === "production") {
  resolveCsrfSecret();
}

// Retained so we can still import randomBytes in the module without a lint warning;
// the dev fallback is now centralized in csrf-constants.
void randomBytes;

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function parseCookies(cookieHeader: string | null) {
  if (!cookieHeader) return new Map<string, string>();
  return new Map(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0) return [part, ""];
        return [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
      }),
  );
}

function signCsrfValue(value: string) {
  return createHmac("sha256", resolveCsrfSecret()).update(value).digest("base64url");
}

export function createSignedCsrfToken() {
  const nonce = toBase64Url(randomBytes(24));
  return `${nonce}.${signCsrfValue(nonce)}`;
}

export function verifySignedCsrfToken(token: string) {
  const [nonce, signature] = token.split(".");
  if (!nonce || !signature) return false;

  const expected = Buffer.from(signCsrfValue(nonce));
  const provided = Buffer.from(signature);

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function resolveTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin")?.trim() || "";
  if (origin) return origin;

  const referer = request.headers.get("referer")?.trim() || "";
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function buildCsrfError(message: string) {
  return NextResponse.json(
    { success: false as const, message, errorCode: "FORBIDDEN" },
    { status: 403 },
  );
}

export function validateCsrf(request: Request): NextResponse | null {
  const host = request.headers.get("host")?.trim() || "";
  const trustedOrigin = resolveTrustedOrigin(request);

  if (!trustedOrigin || !host) {
    return buildCsrfError("Missing trusted request origin");
  }

  try {
    const originHost = new URL(trustedOrigin).host;
    if (originHost !== host) {
      return buildCsrfError("Origin mismatch");
    }
  } catch {
    return buildCsrfError("Invalid origin");
  }

  const cookieMap = parseCookies(request.headers.get("cookie"));
  const cookieToken = cookieMap.get(CSRF_COOKIE_NAME)?.trim() || "";
  const headerToken = request.headers.get(CSRF_HEADER_NAME)?.trim() || "";

  if (!cookieToken || !headerToken) {
    return buildCsrfError("Missing CSRF token");
  }
  if (cookieToken !== headerToken) {
    return buildCsrfError("CSRF token mismatch");
  }
  if (!verifySignedCsrfToken(headerToken)) {
    return buildCsrfError("Invalid CSRF token");
  }

  return null;
}
