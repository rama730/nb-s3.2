export const FILE_REVISION_MODES = ["new_revision", "active_revision"] as const;

export type FileRevisionMode = (typeof FILE_REVISION_MODES)[number];

export function isFileRevisionMode(value: unknown): value is FileRevisionMode {
  return typeof value === "string" && FILE_REVISION_MODES.includes(value as FileRevisionMode);
}

export function parseFileRevisionMode(
  value: unknown,
  fallback: FileRevisionMode = "new_revision",
): FileRevisionMode {
  return isFileRevisionMode(value) ? value : fallback;
}

export function normalizeRevisionComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 500) : null;
}

/**
 * Allocate an append-only version number from history, not from the active
 * pointer. A restored legacy node may point at v1 while v2..v10 still exist;
 * using currentVersion + 1 would collide with that retained history.
 */
export function nextFileRevisionNumber(
  currentVersion: number | null | undefined,
  highestHistoricalVersion: number | null | undefined,
): number {
  const valid = [currentVersion, highestHistoricalVersion].filter(
    (value): value is number => Number.isSafeInteger(value) && Number(value) >= 0,
  );
  return Math.max(0, ...valid) + 1;
}
