import { logger } from "@/lib/logger";

const SAMPLE_RATE = 0.25;

function shouldEmitMetric() {
  if (process.env.NODE_ENV !== "production") return true;
  return Math.random() <= SAMPLE_RATE;
}

export function recordSprintMetric(metric: string, payload: Record<string, unknown>) {
  if (!shouldEmitMetric()) return;
  logger.metric(metric, { ...payload, module: "projects.sprints" });
}
