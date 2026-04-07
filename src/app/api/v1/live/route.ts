import { getRequestId, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  logApiRoute(request, {
    requestId,
    action: "live.get",
    startedAt,
    status: 200,
    success: true,
  });
  return jsonSuccess({ status: "ok", probe: "liveness" });
}
