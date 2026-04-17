import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { CSRF_COOKIE_NAME, DEV_CSRF_SECRET_FALLBACK, MINIMUM_CSRF_SECRET_LENGTH } from "@/lib/security/csrf-constants";

const CSP_NONCE_HEADER = "x-nonce";
const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
const AUTH_PROTECTED_PREFIXES = ["/hub", "/settings", "/messages", "/profile", "/people", "/workspace", "/monitor", "/u/", "/onboarding"];
const AUTH_PROTECTED_EXACT = new Set(["/", "/login", "/signup", "/verify-email"]);

function toBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(signature);
}

// SEC-C2: Unified CSRF secret resolution with the node runtime verifier
// (src/lib/security/csrf.ts). Refuse to sign with the dev fallback when running
// in production so deploys without CSRF_TOKEN_SECRET fail closed instead of
// emitting signatures that the verifier will reject.
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

async function issueSignedCsrfToken() {
  const secret = resolveCsrfSecret();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await signValue(nonce, secret);
  return `${nonce}.${signature}`;
}

function shouldResolveAuthSession(pathname: string) {
  if (AUTH_PROTECTED_EXACT.has(pathname)) {
    return true;
  }

  return AUTH_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isLocalHostname(hostname: string | null | undefined) {
  if (!hostname) return false;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function buildCsp(nonce: string, request: NextRequest) {
  const isProduction = process.env.NODE_ENV === "production";
  const scriptDirectives = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    "https://va.vercel-scripts.com",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
  ];

  const connectDirectives = isProduction
    ? ["'self'", "https:", "wss:"]
    : ["'self'", "https:", "wss:", "http:", "ws:"];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptDirectives.join(" ")}`,
    // SEC-L8: style-src keeps 'unsafe-inline' because Radix UI (the
    // underlying library for shadcn primitives) sets runtime style
    // attributes for positioning popovers, tooltips, menus, and
    // animated transforms. CSP nonces do NOT gate the `style` HTML
    // attribute — only `<style>` elements — so adding a nonce here
    // would either be a no-op (browsers that honor 'unsafe-inline')
    // or break the UI (browsers that treat a nonce/hash as an
    // override of 'unsafe-inline'). If we later remove Radix or
    // migrate every inline style to classNames, drop 'unsafe-inline'
    // and emit `'nonce-${nonce}'` so the Next.js-generated <style>
    // tags remain valid.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectDirectives.join(" ")}`,
    "frame-src 'self' https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  const shouldUpgradeInsecureRequests =
    isProduction
    && request.nextUrl.protocol === "https:"
    && !isLocalHostname(request.nextUrl.hostname);

  if (shouldUpgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(24)).buffer);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const response = shouldResolveAuthSession(request.nextUrl.pathname)
    ? await updateSession(request, { requestHeaders })
    : NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });

  response.headers.set("Content-Security-Policy", buildCsp(nonce, request));
  response.headers.set(CSP_NONCE_HEADER, nonce);

  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value?.trim() || "";
  if (!csrfCookie || !csrfCookie.includes(".")) {
    // SEC-C1: Mark the CSRF cookie httpOnly so it cannot be read via
    // document.cookie. The client fetches the token value from
    // /api/v1/security/csrf and attaches it to the x-csrf-token header.
    response.cookies.set({
      name: CSRF_COOKIE_NAME,
      value: await issueSignedCsrfToken(),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|map|woff2?|ttf|eot)$).*)",
  ],
};
