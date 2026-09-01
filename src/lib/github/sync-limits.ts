/**
 * Shared GitHub Sync capacity limits.
 *
 * Comparison limits protect tree/list rendering. Operation limits protect the
 * immutable reviewed snapshot. Repository limits protect worker disk/memory.
 * Keeping them separate prevents a large workspace from blocking a small,
 * explicitly reviewed synchronization.
 */
export const GITHUB_SYNC_LIMITS = {
  comparisonFiles: 30_000,
  operationFiles: 5_000,
  operationBytes: 512 * 1024 * 1024,
  repositoryFiles: 30_000,
  repositoryBytes: 512 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
} as const;

export function formatSyncMegabytes(bytes: number) {
  return Math.floor(bytes / (1024 * 1024));
}
