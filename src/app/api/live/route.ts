import { NextResponse } from "next/server";
import { getRequestId, logApiRequest } from "@/app/api/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  logApiRequest(request, {
    requestId,
    action: "live.get",
    startedAt,
    status: 200,
    success: true,
  });
  return NextResponse.json(
    { status: "ok", probe: "liveness" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
