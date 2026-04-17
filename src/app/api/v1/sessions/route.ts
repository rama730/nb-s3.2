import {
  enforceRouteLimit,
  getRequestId,
  getSessionIdentifier,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { listActiveSessionsPage } from "@/lib/security/session-activity";

type SessionPayload = {
  id: string;
  device_info: { userAgent: string };
  ip_address: string;
  last_active: string;
  created_at?: string;
  is_current?: boolean;
  aal?: "aal1" | "aal2" | null;
};

function parsePaginationNumber(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(parsed), max));
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:sessions:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  if (!auth.user) {
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, parsePaginationNumber(searchParams.get("limit"), 12, 50));
    const offset = parsePaginationNumber(searchParams.get("offset"), 0, 500);
    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const currentSessionId =
      session ? getSessionIdentifier(session) ?? null : null;
    const page = await listActiveSessionsPage(auth.user.id, currentSessionId, { limit, offset });
    const sessions: SessionPayload[] = page.sessions;

    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({
      sessions,
      pagination: {
        limit,
        offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      },
    });
  } catch (error) {
    logger.error("[api/v1/sessions] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load sessions", 500, "INTERNAL_ERROR");
  }
}
