// Backward-compatible alias. Canonical endpoint: /api/v1/live
import { GET as liveGet } from "@/app/api/v1/live/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return liveGet(request);
}
