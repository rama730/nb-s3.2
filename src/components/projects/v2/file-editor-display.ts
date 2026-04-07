const OPERATION_LABELS: Record<string, string> = {
  lock_acquire: "Locked",
  lock_release: "Lock released",
  save: "Saved",
  create_file: "Created file",
  create_folder: "Created folder",
  rename: "Renamed",
  delete: "Deleted",
  restore: "Restored",
};

export function getOperationLabel(type: string) {
  if (OPERATION_LABELS[type]) {
    return OPERATION_LABELS[type];
  }

  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getLockDisplayName(lockInfo?: {
  lockedBy: string;
  lockedByName?: string | null;
  expiresAt: number;
} | null) {
  const displayName = lockInfo?.lockedByName?.trim();
  return displayName && displayName.length > 0 ? displayName : "Locked by collaborator";
}
