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

/** Preserve extensions and reserve every chosen name within this upload batch. */
export function planUploadCopyNames(names: readonly string[], occupiedNames: readonly string[]): string[] {
  const occupied = new Set(occupiedNames.map(name => name.toLowerCase()));
  return names.map(name => {
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    for (let copy = 2; occupied.has(candidate.toLowerCase()); copy += 1)
      candidate = `${stem} (${copy})${extension}`;
    occupied.add(candidate.toLowerCase());
    return candidate;
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
