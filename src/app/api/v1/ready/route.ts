import { getRequestId, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";

export const dynamic = "force-dynamic";

/** Minimal readiness probe: returns 200 when HTTP server can serve. Used by E2E webServer. */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  logApiRoute(request, {
    requestId,
    action: "ready.get",
    startedAt,
    status: 200,
    success: true,
  });
  return jsonSuccess({ ok: true });
}
