import {
  enforceRouteLimit,
  getRequestId,
  getSessionIdentifier,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { listActiveSessions } from "@/lib/security/session-activity";

type SessionPayload = {
  id: string;
  device_info: { userAgent: string };
  ip_address: string;
  last_active: string;
  created_at?: string;
  is_current?: boolean;
  aal?: "aal1" | "aal2" | null;
};

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
    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const currentSessionId =
      session ? getSessionIdentifier(session) ?? null : null;
    const sessions: SessionPayload[] = await listActiveSessions(auth.user.id, currentSessionId, 12);

    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ sessions });
  } catch (error) {
    console.error("[api/v1/sessions] failed", error);
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
