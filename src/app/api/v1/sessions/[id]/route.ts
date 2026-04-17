import { validateCsrf } from "@/lib/security/csrf";
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
import { resolveCurrentSessionRowId } from "@/lib/security/session-current";
import { listActiveSessions } from "@/lib/security/session-activity";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:sessions:delete", 60, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
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
      action: "sessions.delete",
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
      action: "sessions.delete",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const { id } = await context.params;
  const {
    data: { session },
  } = await auth.supabase.auth.getSession();
  const currentSessionId = getSessionIdentifier(session);
  let resolvedCurrentSessionId = currentSessionId;

  if (!resolvedCurrentSessionId || id !== resolvedCurrentSessionId) {
    const activeSessions = await listActiveSessions(auth.user.id, currentSessionId, 12);
    resolvedCurrentSessionId = resolveCurrentSessionRowId(
      activeSessions.map((activeSession) => activeSession.id),
      currentSessionId,
    );
  }

  if (id !== resolvedCurrentSessionId) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Session not found", 404, "NOT_FOUND");
  }

  try {
    const result = await auth.supabase.auth.signOut({ scope: "global" });
    if (result.error) {
      logApiRoute(request, {
        requestId,
        action: "sessions.delete",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "SESSION_REVOKE_FAILED",
      });
      return jsonError("Failed to revoke session", 400, "SESSION_REVOKE_FAILED");
    }
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Session revoked");
  } catch (error) {
    logger.error("[api/v1/sessions/:id] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to revoke session", 500, "INTERNAL_ERROR");
  }
}
