import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { listLoginHistory } from "@/lib/security/session-activity";

type LoginHistoryEntry = {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  location?: string;
  aal?: "aal1" | "aal2" | null;
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:login-history:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
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
      action: "auth.loginHistory.get",
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
      action: "auth.loginHistory.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const history: LoginHistoryEntry[] = await listLoginHistory(auth.user.id, limit);

    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ history, limit });
  } catch (error) {
    logger.error("[api/v1/auth/login-history] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load login history", 500, "INTERNAL_ERROR");
  }
}
