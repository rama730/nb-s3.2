export const FILES_RUNTIME_BUDGETS = {
  visibleRowsCacheMaxKeys: 200,
  visibleRowsCacheTtlMs: 10 * 60 * 1000,
  fileCacheMinEntries: 32,
  fileCacheFallbackEntries: 64,
  fileCacheMaxEntries: 256,
  maxInFlightFolderRequests: 8,
  maxInFlightContentRequests: 16,
  maxFolderBatchRowsPerInteraction: 1500,
  indexQueueMinConcurrency: 2,
  indexQueueMaxConcurrency: 4,
  autosaveDelayMinMs: 1500,
  autosaveDelayDefaultMs: 2500,
  autosaveDelayMaxMs: 6000,
  backgroundAutosaveDefaultConcurrency: 2,
  backgroundAutosaveMaxConcurrency: 4,
  saveAllConcurrency: 3,
} as const;

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
