import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";
import { consumeRateLimitForRoute } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import type { User } from "@supabase/supabase-js";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
export { jsonError, jsonSuccess };
export type { ApiErrorCode } from "@/app/api/v1/_envelope";
import type { ApiErrorCode } from "@/app/api/v1/_envelope";

export function getRequestIp(request: Request) {
  return getTrustedRequestIp(request) ?? "unknown";
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
    sampleRate: input.success ? 0.02 : 1,
  });
}

export function getSessionIdentifier(
  session: { access_token?: string } | null | undefined,
): string | null {
  return getSessionIdentifierFromSession(session);
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

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { extensionDeviceSessions } from "@/lib/db/schema";
import crypto from "crypto";
import { eq } from "drizzle-orm";

function normalizeSessionHeader(value: string | null, maxLength = 120) {
  if (!value) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export async function requireAuthenticatedUser() {
  const supabase = await createClient();

  // 1. Check for Bearer token authentication
  try {
    const headerStore = await headers();
    const authHeader = headerStore.get("authorization")?.trim();
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.substring(7).trim();
      if (token.startsWith("nb_dev_")) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const now = new Date();
        const session = await db.query.extensionDeviceSessions.findFirst({
          where: (s, { eq, and, isNull, gt }) => and(
            eq(s.tokenHash, tokenHash),
            isNull(s.revokedAt),
            gt(s.expiresAt, now)
          )
        });

        if (session) {
          const profile = await db.query.profiles.findFirst({
            where: (p, { eq }) => eq(p.id, session.userId),
            columns: { email: true }
          });

          const extensionVersion = normalizeSessionHeader(headerStore.get("x-extension-version"), 40);
          const editorHost = normalizeSessionHeader(headerStore.get("x-editor-host"), 80);
          const editorName = normalizeSessionHeader(headerStore.get("x-editor-name"), 120);
          const editorPlatform = normalizeSessionHeader(headerStore.get("x-editor-platform"), 80);
          const editorVersion = normalizeSessionHeader(headerStore.get("x-editor-version"), 80);
          const userAgent = normalizeSessionHeader(headerStore.get("user-agent"), 240);
          const updates: Partial<typeof extensionDeviceSessions.$inferInsert> = { lastSeenAt: now };
          if (extensionVersion && session.clientVersion !== extensionVersion) {
            updates.clientVersion = extensionVersion;
          }
          if (editorHost && session.editorHost !== editorHost) {
            updates.editorHost = editorHost;
          }
          if (editorName && session.editorName !== editorName) {
            updates.editorName = editorName;
          }
          if (editorPlatform && session.editorPlatform !== editorPlatform) {
            updates.editorPlatform = editorPlatform;
          }
          if (editorVersion && session.editorVersion !== editorVersion) {
            updates.editorVersion = editorVersion;
          }
          if (userAgent && session.userAgent !== userAgent) {
            updates.userAgent = userAgent;
          }

          // Update lastSeenAt asynchronously
          void db
            .update(extensionDeviceSessions)
            .set(updates)
            .where(eq(extensionDeviceSessions.id, session.id))
            .catch(() => null);

          const mockUser: User = {
            id: session.userId,
            email: profile?.email || "",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
            identities: [],
            factors: [],
            created_at: session.createdAt.toISOString(),
            updated_at: session.lastSeenAt.toISOString(),
          } as any;

          return { supabase, user: mockUser, extensionSessionId: session.id, response: null };
        }
      }
    }
  } catch (error) {
    logger.error("api.v1.shared.bearer_auth_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // 2. Fall back to standard session cookie check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null as User | null,
      extensionSessionId: null as string | null,
      response: jsonError("Not authenticated", 401, "UNAUTHORIZED"),
    };
  }
  return {
    supabase,
    user,
    extensionSessionId: null as string | null,
    response: null as ReturnType<typeof jsonError> | null,
  };
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
