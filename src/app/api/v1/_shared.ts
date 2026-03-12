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

export async function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithBoundedRetry(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; maxAttempts?: number } = {},
) {
  const timeoutMs = Math.max(250, init.timeoutMs ?? 4_000);
  const maxAttempts = Math.max(1, Math.min(3, init.maxAttempts ?? 2));
  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(
        (signal) =>
          fetch(input, {
            ...init,
            signal,
          }),
        timeoutMs,
      );

      if (response.ok || !retryableStatuses.has(response.status) || attempt >= maxAttempts) {
        return response;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500 * attempt, 1_500)));
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500 * attempt, 1_500)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithBoundedRetry failed");
}
