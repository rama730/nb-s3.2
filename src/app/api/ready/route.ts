import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Minimal readiness probe: returns 200 when HTTP server can serve. Used by E2E webServer. */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
