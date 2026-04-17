import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { CSRF_COOKIE_NAME } from "@/lib/security/csrf-constants";
import {
  createSignedCsrfToken,
  verifySignedCsrfToken,
} from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

/**
 * SEC-C1: CSRF token delivery endpoint.
 *
 * The CSRF cookie is httpOnly, so browser JS cannot read it via document.cookie.
 * This endpoint returns the current cookie value so the client-side fetch
 * wrapper can echo it back in the x-csrf-token header (double-submit pattern).
 *
 * If no valid cookie exists, a fresh signed token is minted and set, keeping
 * the middleware's lazy-issue behaviour in sync.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const rateLimitResponse = await enforceRouteLimit(request, "api:v1:security:csrf", 120, 60);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const cookieStore = await cookies();
    const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value?.trim() || "";

    if (existing && existing.includes(".") && verifySignedCsrfToken(existing)) {
      return jsonSuccess({ token: existing });
    }

    const token = createSignedCsrfToken();
    const response = jsonSuccess({ token });
    response.cookies.set({
      name: CSRF_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    return jsonError("Unable to issue CSRF token", 500, "INTERNAL_ERROR");
  }
}
