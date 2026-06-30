import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { redis } from "@/lib/redis";

type BulkJobHash = {
  userId?: string;
  action?: string;
  status?: string;
  total?: string;
  completed?: string;
  failed?: string;
  error?: string;
};

type BulkJobStatus = {
  status: string;
  action: string | null;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
};

function parseCount(value: string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const limitResponse = await enforceRouteLimit(
    request,
    `api:v1:jobs:connection-bulk:get:${auth.user.id}`,
    120,
    60,
  );
  if (limitResponse) return limitResponse;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return jsonError("jobId is required", 400, "BAD_REQUEST");
  }

  if (!redis) {
    return jsonError("Bulk job status is unavailable", 503, "UNAVAILABLE");
  }

  const hash = await redis.hgetall<BulkJobHash>(`bulk_job:${jobId}`);
  if (!hash || Object.keys(hash).length === 0) {
    return jsonError("Bulk job not found", 404, "NOT_FOUND");
  }

  if (hash.userId && hash.userId !== auth.user.id) {
    return jsonError("Bulk job not found", 404, "NOT_FOUND");
  }

  const rawStatus = hash.status ?? "pending";
  const status = rawStatus === "done" ? "completed" : rawStatus;
  const payload: BulkJobStatus = {
    status,
    action: hash.action ?? null,
    total: parseCount(hash.total),
    completed: parseCount(hash.completed),
    failed: parseCount(hash.failed),
    error: hash.error ?? null,
  };

  return jsonSuccess(payload);
}
