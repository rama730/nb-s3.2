import { logger } from '@/lib/logger'

type FilesMetric =
  | "files.save.latency_ms"
  | "files.lock.acquire_ms"
  | "files.lock.conflict_count"
  | "files.search.latency_ms"
  | "files.folder.load.latency_ms"
  | "files.autosave.success_count"
  | "files.autosave.failure_count"
  | "files.index.queue.depth"
  | "files.offline.flush.success_count"
  | "files.offline.flush.failure_count"
  | "files.git.push.latency_ms"
  | "files.git.pull.latency_ms"
  | "files.terminal.command_count"
  | "files.asset.gallery.load_ms";

type FilesMetricPayload = {
  projectId: string;
  correlationId?: string;
  nodeId?: string;
  value: number;
  extra?: Record<string, unknown>;
};

const SAMPLE_RATE = 0.2;

function shouldEmit() {
  if (process.env.NODE_ENV !== "production") return true;
  return Math.random() <= SAMPLE_RATE;
}

export function createFilesCorrelationId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordFilesMetric(metric: FilesMetric, payload: FilesMetricPayload) {
  if (!shouldEmit()) return;
  logger.metric(metric, {
    module: 'files',
    ts: Date.now(),
    ...payload,
  });
}
