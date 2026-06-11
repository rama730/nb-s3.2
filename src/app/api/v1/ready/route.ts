import { enforceRouteLimit, getRequestId, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";

export const dynamic = "force-dynamic";

/** Minimal readiness probe: returns 200 when HTTP server can serve. Used by E2E webServer. */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const limitResponse = await enforceRouteLimit(request, "api:v1:ready:check", 60, 60, "ready");
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "ready.get",
      startedAt,
      status: 429,
      success: false,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }
  logApiRoute(request, {
    requestId,
    action: "ready.get",
    startedAt,
    status: 200,
    success: true,
  });
  return jsonSuccess({ ok: true });
}
