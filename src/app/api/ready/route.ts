// Backward-compatible alias. Canonical endpoint: /api/v1/ready
import { GET as readyGet } from "@/app/api/v1/ready/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return readyGet(request);
}
