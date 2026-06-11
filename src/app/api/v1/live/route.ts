import { enforceRouteLimit, getRequestId, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const limitResponse = await enforceRouteLimit(request, "api:v1:live:check", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "live.get",
      startedAt,
      status: 429,
      success: false,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }
  logApiRoute(request, {
    requestId,
    action: "live.get",
    startedAt,
    status: 200,
    success: true,
  });
  return jsonSuccess({ status: "ok", probe: "liveness" });
}
