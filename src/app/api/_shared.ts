import { logger } from "@/lib/logger";

export function getRequestId(request: Request) {
  const fromHeader = request.headers.get("x-request-id")?.trim();
  if (fromHeader) return fromHeader;
  return crypto.randomUUID();
}

export function getRequestPath(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

export function logApiRequest(
  request: Request,
  input: {
    requestId: string;
    action: string;
    startedAt: number;
    status: number;
    success: boolean;
    userId?: string | null;
    errorCode?: string;
  },
) {
  logger.info("api.request", {
    requestId: input.requestId,
    route: getRequestPath(request),
    action: input.action,
    durationMs: Date.now() - input.startedAt,
    status: input.status,
    success: input.success,
    userId: input.userId ?? undefined,
    errorCode: input.errorCode ?? null,
    sampleRate: input.success ? 0.02 : 1,
  });
}
