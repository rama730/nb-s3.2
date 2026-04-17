import { validateCsrf } from "@/lib/security/csrf";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteAll",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:sessions:delete-all", 20, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteAll",
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
      action: "sessions.deleteAll",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }

  try {
    const result = await auth.supabase.auth.signOut({ scope: "global" });
    if (result.error) {
      logApiRoute(request, {
        requestId,
        action: "sessions.deleteAll",
        userId: auth.user?.id ?? null,
        startedAt,
        success: false,
        status: 400,
        errorCode: "SESSION_REVOKE_FAILED",
      });
      return jsonError("Failed to revoke sessions", 400, "SESSION_REVOKE_FAILED");
    }
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteAll",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "All sessions revoked");
  } catch (error) {
    logger.error("[api/v1/sessions/all] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteAll",
      userId: auth.user?.id ?? null,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to revoke sessions", 500, "INTERNAL_ERROR");
  }
}
