import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
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
    const history: LoginHistoryEntry[] = await listLoginHistory(auth.user.id, 20);

    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ history });
  } catch (error) {
    console.error("[api/v1/auth/login-history] failed", error);
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
