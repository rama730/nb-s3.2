import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";

export type IndexQueueRuntimeState = {
  averageLatencyMs: number;
  failureCountWindow: number;
};

export function createInitialIndexQueueState(): IndexQueueRuntimeState {
  return {
    averageLatencyMs: 0,
    failureCountWindow: 0,
  };
}

export function getIndexQueueConcurrency(
  queueDepth: number,
  runtimeState: IndexQueueRuntimeState
) {
  const { indexQueueMinConcurrency, indexQueueMaxConcurrency } = FILES_RUNTIME_BUDGETS;
  if (runtimeState.failureCountWindow >= 3) return indexQueueMinConcurrency;
  if (runtimeState.averageLatencyMs > 3000) return indexQueueMinConcurrency;
  if (queueDepth >= 30 && runtimeState.averageLatencyMs > 0 && runtimeState.averageLatencyMs < 1200) {
    return indexQueueMaxConcurrency;
  }
  if (queueDepth >= 10 && runtimeState.averageLatencyMs > 0 && runtimeState.averageLatencyMs < 1800) {
    return Math.min(indexQueueMaxConcurrency, indexQueueMinConcurrency + 1);
  }
  return indexQueueMinConcurrency;
}

export function updateIndexQueueRuntimeState(
  state: IndexQueueRuntimeState,
  options: { latencyMs: number; success: boolean }
) {
  const latencyMs = Math.max(0, options.latencyMs);
  const prev = state.averageLatencyMs;
  state.averageLatencyMs = prev === 0 ? latencyMs : Math.round(prev * 0.7 + latencyMs * 0.3);
  if (options.success) {
    state.failureCountWindow = Math.max(0, state.failureCountWindow - 1);
  } else {
    state.failureCountWindow = Math.min(10, state.failureCountWindow + 1);
  }
}
