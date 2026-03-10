import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimitForRoute } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import type { User } from "@supabase/supabase-js";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
export { jsonError, jsonSuccess };
export type { ApiErrorCode } from "@/app/api/v1/_envelope";
import type { ApiErrorCode } from "@/app/api/v1/_envelope";

export function getRequestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function getRequestPath(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

export function getRequestId(request: Request) {
  const fromHeader = request.headers.get("x-request-id")?.trim();
  if (fromHeader) return fromHeader;
  return crypto.randomUUID();
}

export function logApiRoute(
  request: Request,
  input: {
    requestId: string;
    action: string;
    userId?: string | null;
    startedAt: number;
    success: boolean;
    status: number;
    errorCode?: ApiErrorCode;
  },
) {
  logger.info("api.v1.request", {
    requestId: input.requestId,
    route: getRequestPath(request),
    action: input.action,
    userId: input.userId ?? undefined,
    durationMs: Date.now() - input.startedAt,
    status: input.status,
    success: input.success,
    errorCode: input.errorCode ?? null,
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function getSessionIdentifier(
  session: { access_token?: string } | null | undefined,
): string | null {
  if (!session) return null;

  const explicit = (session as { id?: unknown }).id;
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit;

  const maybeSessionId = (session as { session_id?: unknown }).session_id;
  if (typeof maybeSessionId === "string" && maybeSessionId.trim().length > 0) {
    return maybeSessionId;
  }

  const accessToken = session.access_token;
  if (!accessToken) return null;
  const claims = decodeJwtPayload(accessToken);
  if (!claims) return null;

  const tokenSessionId = claims.session_id;
  if (typeof tokenSessionId === "string" && tokenSessionId.trim().length > 0) {
    return tokenSessionId;
  }

  const tokenJti = claims.jti;
  if (typeof tokenJti === "string" && tokenJti.trim().length > 0) {
    return tokenJti;
  }

  return null;
}

export async function enforceRouteLimit(
  request: Request,
  key: string,
  limit: number,
  windowSeconds: number,
  route: "default" | "publicRead" | "health" | "ready" = "default",
) {
  const ip = getRequestIp(request);
  const rl = await consumeRateLimitForRoute(route, `${key}:${ip}`, limit, windowSeconds);
  if (!rl.allowed) {
    return jsonError("Rate limit exceeded", 429, "RATE_LIMITED");
  }
  return null;
}

export async function requireAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null as User | null,
      response: jsonError("Not authenticated", 401, "UNAUTHORIZED"),
    };
  }
  return { supabase, user, response: null as ReturnType<typeof jsonError> | null };
}
