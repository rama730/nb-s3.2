"use client";

import { useCallback, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { FileVersion, ProjectNode } from "@/lib/db/schema";
import { applyUploadedFileRevision, listFileVersions, restoreFileVersion, deleteFileVersionAction } from "@/app/actions/files/versions";
import { getUploadPresignedUrl } from "@/app/actions/upload";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { computeContentHash } from "@/lib/files/content-hash";
import type { FileRevisionMode } from "@/lib/files/revision-policy";
import {
  acquireBrowserFileLease,
  releaseBrowserFileLease,
  type BrowserFileLease,
} from "@/lib/files/file-lease-client";
import { newClientId } from "@/lib/utils/client-id";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockConflictInfo {
  lockedBy: { userId: string; displayName: string; lockedAt: string };
}

export type FileVersionWithProfile = FileVersion & {
  uploadedByName?: string | null;
  uploadedByUsername?: string | null;
};

export interface UseFileVersionsReturn {
  versions: FileVersionWithProfile[];
  isLoading: boolean;
  error: string | null;
  listVersions: () => Promise<FileVersionWithProfile[]>;
  saveAsNewVersion: (
    file: File,
    options?: { comment?: string | null },
  ) => Promise<
    | { success: true; node: ProjectNode; version: FileVersion }
    | { success: false; error: string; lockConflict?: LockConflictInfo }
  >;
  restoreVersion: (versionNumber: number) => Promise<
    | { success: true; version: FileVersion; node: ProjectNode }
    | { success: false; error: string }
  >;
  deleteVersion: (versionNumber: number) => Promise<
    | { success: true; nextActiveVersion?: number | null; node?: ProjectNode }
    | { success: false; error: string }
  >;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extOf(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() || "") : "";
}

/**
 * Parse a lock-conflict error from the server action. The server currently
 * throws a plain Error with a message like "File is locked by another
 * collaborator" or a JSON-encoded structured error. We handle both.
 */
function parseLockConflictError(error: unknown): LockConflictInfo | undefined {
  if (!(error instanceof Error)) return undefined;
  const msg = error.message;

  // Check for structured JSON error (future-proof for when the server returns structured data)
  if (msg.startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.error === "lock_conflict" && parsed.lockedBy) {
        return {
          lockedBy: {
            userId: parsed.lockedBy.userId ?? "",
            displayName: parsed.lockedBy.displayName ?? "Another user",
            lockedAt: parsed.lockedBy.lockedAt ?? new Date().toISOString(),
          },
        };
      }
    } catch {
      // Not JSON, fall through
    }
  }

  // Check for the plain-text lock error message
  if (msg.includes("locked by another")) {
    return {
      lockedBy: {
        userId: "",
        displayName: "Another user",
        lockedAt: new Date().toISOString(),
      },
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Standalone save utility — used by both useFileVersions and useTaskFileMutations
// ---------------------------------------------------------------------------

/**
 * Core logic for uploading a file as a new version of an existing node.
 * Handles presigned URL fetch, S3 upload, content hashing, lock-conflict
 * detection, and orphan blob cleanup.
 *
 * This is exported so that `useTaskFileMutations` can delegate its
 * `saveAsNewVersion` call here without duplicating the upload pipeline.
 */
export async function saveFileRevision(params: {
  projectId: string;
  nodeId: string;
  file: File;
  mode: FileRevisionMode;
  comment?: string | null;
  baseVersion?: number | null;
  baseHash?: string | null;
  lease?: BrowserFileLease | null;
  supabase: ReturnType<typeof createClient>;
}): Promise<
  | { success: true; node: ProjectNode; version: FileVersion }
  | { success: false; error: string; lockConflict?: LockConflictInfo }
> {
  const { projectId, nodeId, file, mode, comment, baseVersion, baseHash, supabase } = params;
  let storagePath: string | null = null;
  let ownedLease = params.lease ?? null;
  const transientLease = !ownedLease;

  try {
    ownedLease = ownedLease ?? await acquireBrowserFileLease(projectId, nodeId);
    const fileExt = extOf(file.name);
    const opaque = newClientId();
    storagePath = buildProjectFileKey(
      projectId,
      `${opaque}${fileExt ? `.${fileExt}` : ""}`,
    );
    const contentType = file.type || "application/octet-stream";

    // Hash in parallel with the presigned-URL fetch
    const [uploadSession, hashResult] = await Promise.all([
      getUploadPresignedUrl(storagePath, contentType, file.size),
      computeContentHash(file).catch(() => null),
    ]);

    if ("error" in uploadSession) {
      throw new Error(uploadSession.error || "Failed to prepare upload");
    }

    const uploadResponse = await fetch(uploadSession.url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed (${uploadResponse.status})`);
    }

    const contentHash =
      hashResult && hashResult.kind === "full" ? hashResult.hashHex : null;

    const result = await applyUploadedFileRevision({
      projectId,
      nodeId,
      s3Key: storagePath,
      size: file.size,
      mimeType: contentType,
      contentHash,
      uploadIntentId: uploadSession.uploadIntentId,
      comment: comment ?? null,
      mode,
      baseVersion,
      baseHash,
      lease: {
        leaseId: ownedLease.leaseId,
        sessionId: ownedLease.sessionId,
        fencingToken: ownedLease.fencingToken,
      },
    });

    // Handle structured lock conflict error returned from the server action
    if ("error" in result) {
      return {
        success: false,
        error: "File is locked by another collaborator",
        lockConflict: { lockedBy: result.lockedBy },
      };
    }

    return { success: true, node: result.node, version: result.version };
  } catch (err) {
    // Best-effort orphan cleanup
    if (storagePath) {
      await supabase.storage
        .from("project-files")
        .remove([storagePath])
        .catch(() => null);
    }

    // Check for lock conflict — return structured error instead of throwing
    const lockConflict = parseLockConflictError(err);
    const message = err instanceof Error ? err.message : "Upload failed";

    if (lockConflict) {
      return { success: false, error: message, lockConflict };
    }

    return { success: false, error: message };
  } finally {
    if (transientLease && ownedLease) {
      await releaseBrowserFileLease(ownedLease).catch(() => null);
    }
  }
}

export async function saveFileAsNewVersion(
  params: Omit<Parameters<typeof saveFileRevision>[0], "mode">,
) {
  return saveFileRevision({ ...params, mode: "new_revision" });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Standalone hook for file version operations. Does NOT require a `taskId`.
 * Both the Files tab and the Task panel can manage versions through this API.
 *
 * @param projectId - The project containing the file node
 * @param nodeId - The file node to manage versions for
 */
export function useFileVersions(projectId: string, nodeId: string): UseFileVersionsReturn {
  const supabase = useMemo(() => createClient(), []);
  const [versions, setVersions] = useState<FileVersionWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // listVersions — fetches all versions sorted by versionNumber descending
  // -------------------------------------------------------------------------
  const listVersions = useCallback(async (): Promise<FileVersionWithProfile[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await listFileVersions(projectId, nodeId);
      setVersions(rows);
      return rows;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load versions";
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [projectId, nodeId]);

  // -------------------------------------------------------------------------
  // saveAsNewVersion — delegates to the standalone saveFileAsNewVersion utility
  // -------------------------------------------------------------------------
  const saveAsNewVersion = useCallback(
    async (
      file: File,
      options?: { comment?: string | null },
    ): Promise<
      | { success: true; node: ProjectNode; version: FileVersion }
      | { success: false; error: string; lockConflict?: LockConflictInfo }
    > => {
      setError(null);

      const result = await saveFileAsNewVersion({
        projectId,
        nodeId,
        file,
        comment: options?.comment,
        supabase,
      });

      if (result.success) {
        // Update local versions cache optimistically
        setVersions((prev) => [result.version, ...prev]);
      } else {
        setError(result.error);
      }

      return result;
    },
    [projectId, nodeId, supabase],
  );

  // -------------------------------------------------------------------------
  // restoreVersion — restores a historical version as the new current version
  // -------------------------------------------------------------------------
  const restoreVersion = useCallback(
    async (
      versionNumber: number,
    ): Promise<
      | { success: true; version: FileVersion; node: ProjectNode }
      | { success: false; error: string }
    > => {
      setError(null);
      try {
        const result = await restoreFileVersion(projectId, nodeId, versionNumber);

        return { success: true, version: result.version, node: result.node as ProjectNode };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Restore failed";
        setError(message);
        return { success: false, error: message };
      }
    },
    [projectId, nodeId],
  );

  // -------------------------------------------------------------------------
  // deleteVersion — deletes a specific historical version
  // -------------------------------------------------------------------------
  const deleteVersion = useCallback(
    async (
      versionNumber: number,
    ): Promise<
      | { success: true; nextActiveVersion?: number | null; node?: ProjectNode }
      | { success: false; error: string }
    > => {
      setError(null);
      setIsLoading(true);
      try {
        const result = await deleteFileVersionAction(projectId, nodeId, versionNumber);
        if (result.success) {
          // Optimistically update local versions list by filtering out the deleted version
          setVersions((prev) => prev.filter((v) => v.version !== versionNumber));
        }
        return { success: true, nextActiveVersion: result.nextActiveVersion, node: result.node as ProjectNode | undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Delete failed";
        setError(message);
        return { success: false, error: message };
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, nodeId],
  );

  return useMemo(() => ({
    versions,
    isLoading,
    error,
    listVersions,
    saveAsNewVersion,
    restoreVersion,
    deleteVersion,
  }), [versions, isLoading, error, listVersions, saveAsNewVersion, restoreVersion, deleteVersion]);
}
