import { NextResponse } from "next/server";
import { getRequestId, logApiRequest } from "@/app/api/_shared";

export const dynamic = "force-dynamic";

/** Minimal readiness probe: returns 200 when HTTP server can serve. Used by E2E webServer. */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  logApiRequest(request, {
    requestId,
    action: "ready.get",
    startedAt,
    status: 200,
    success: true,
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
