import { logger } from "@/lib/logger";

type ExtensionMetricPayload = {
  action: string;
  success: boolean;
  durationMs?: number;
  userId?: string | null;
  projectId?: string | null;
  nodeId?: string | null;
  sessionId?: string | null;
  uploadIntentId?: string | null;
  path?: string | null;
  method?: string | null;
  status?: number | null;
  errorCode?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
  count?: number | null;
  chunkCount?: number | null;
};

export function recordExtensionMetric(metric: string, payload: ExtensionMetricPayload) {
  logger.metric(metric, {
    route: "extension",
    ...payload,
  });
}

export async function withExtensionTiming<T>(
  metric: string,
  payload: Omit<ExtensionMetricPayload, "success" | "durationMs">,
  fn: () => Promise<T>,
) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    recordExtensionMetric(metric, {
      ...payload,
      success: true,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    recordExtensionMetric(metric, {
      ...payload,
      success: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
