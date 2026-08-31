import type { UploadCollisionSummary } from "@/app/actions/files/mutations";

/** Retry safely: leave existing destinations intact and send each filename once. */
export function selectUploadFiles<T extends { name: string }>(files: readonly T[], existingFiles: readonly string[]): T[] {
  const seen = new Set(existingFiles.map(name => name.toLowerCase()));
  return files.filter(file => {
    const name = file.name.toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/**
 * One consistent confirmation message for every upload entry point.
 * Existing folders are safely reused; existing files are left untouched.
 */
export function getUploadCollisionMessage(summary: UploadCollisionSummary): string | null {
  const folderCount = summary.existingFolders.length;
  const fileCount = summary.existingFiles.length;
  if (folderCount === 0 && fileCount === 0) return null;

  const parts: string[] = [];
  if (folderCount > 0) {
    parts.push(`${folderCount} existing folder${folderCount === 1 ? "" : "s"} will be reused`);
  }
  if (fileCount > 0) {
    parts.push(`${fileCount} existing file${fileCount === 1 ? "" : "s"} will be skipped`);
  }
  return `Some uploaded items already exist. ${parts.join(" and ")}. Continue?`;
}

export function confirmUploadCollisions(summary: UploadCollisionSummary): boolean {
  const message = getUploadCollisionMessage(summary);
  return message === null || window.confirm(message);
}
