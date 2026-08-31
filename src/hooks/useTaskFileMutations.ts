"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema";
import { linkNodeToTask, unlinkNodeFromTask } from "@/app/actions/files/links";
import {
  createFileNode,
  createFolder,
  getOrCreateTaskSystemFolderAction,
  getUploadCollisionSummary,
} from "@/app/actions/files/mutations";
import { getUploadPresignedUrl } from "@/app/actions/upload";
import { applyUploadedFileRevision } from "@/app/actions/files/versions";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import type { DroppedFolder } from "@/lib/files/folder-drop";
import { newClientId } from "@/lib/utils/client-id";
import { saveFileAsNewVersion as saveFileAsNewVersionOrig } from "@/hooks/useFileVersions";
import type { TaskFileRole } from "@/lib/projects/task-file-intelligence";
import { confirmUploadCollisions } from "@/lib/files/upload-collisions";

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// We keep dummy types for TS compatibility with parent components if they import them.
export type TaskFileUploadStatus = { id: string; status: "uploading" | "success" | "error"; progress: number; filename: string };
export type TaskFilePendingResolution = null;

function extOf(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() || "") : "";
}

function appendUploadSuffix(filename: string, suffix: number) {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return `${filename}-${suffix}`;
  return `${filename.slice(0, idx)}-${suffix}${filename.slice(idx)}`;
}

export function useTaskFileMutations(params: {
  projectId: string;
  taskId: string;
  canEdit: boolean;
  enabled: boolean;
  attachments: (ProjectNode & { annotation?: string | null })[];
  setAttachments: React.Dispatch<React.SetStateAction<ProjectNode[]>>;
  refreshAttachments: () => Promise<ProjectNode[]>;
  onError?: (message: string | null) => void;
  onAfterMutation?: () => Promise<void> | void;
}) {
  const {
    projectId,
    taskId,
    canEdit,
    setAttachments,
    refreshAttachments,
    onError,
    onAfterMutation,
  } = params;

  const supabase = useMemo(() => createClient(), []);
  const [isUploading, setIsUploading] = useState(false);
  const runAfterSuccess = useCallback(async () => {
    window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId, taskId } }));
    try {
      await refreshAttachments();
      await onAfterMutation?.();
    } catch {
      onError?.("Change saved. Could not refresh the file list; reopen Files to retry.");
    }
  }, [onAfterMutation, refreshAttachments, projectId, taskId, onError]);

  const uploadFile = useCallback(async (file: File, options?: { parentId?: string | null; linkToTask?: boolean; taskOwned?: boolean; annotation?: string | null; role?: TaskFileRole }) => {
    let storagePath: string | null = null;
    let createdNode: ProjectNode | null = null;

    try {
      const fileExt = extOf(file.name);
      const opaque = newClientId();
      storagePath = buildProjectFileKey(projectId, `${opaque}${fileExt ? `.${fileExt}` : ""}`);
      const contentType = file.type || "application/octet-stream";

      const uploadSession = await getUploadPresignedUrl(storagePath, contentType, file.size);
      if ("error" in uploadSession) throw new Error(uploadSession.error || "Failed to prepare upload");

      const token = uploadSession.token || new URL(uploadSession.url).searchParams.get("token");
      if (!token) throw new Error("Upload token is missing");

      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .uploadToSignedUrl(storagePath, token, file, { contentType });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      let candidateName = file.name;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          createdNode = (await createFileNode(projectId, options?.parentId ?? null, {
            name: candidateName,
            s3Key: storagePath,
            size: file.size,
            mimeType: contentType,
            uploadIntentId: uploadSession.uploadIntentId,
            taskId: options?.linkToTask || options?.taskOwned ? taskId : undefined,
            taskLink: options?.linkToTask ? { role: options.role, annotation: options.annotation } : undefined,
          })) as ProjectNode;
          break;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("already exists in this location")) throw error;
          candidateName = appendUploadSuffix(file.name, attempt + 1);
        }
      }

      if (!createdNode) throw new Error("Failed to create attachment record");

      return { success: true as const, node: createdNode };
    } catch (error) {
      // Finalization may have committed even if its response was lost. Never
      // delete the uploaded object here; the upload-intent cleanup owns orphans.
      window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId, taskId } }));
      return { success: false as const, error: error instanceof Error ? error.message : "Upload failed" };
    }
  }, [projectId, supabase.storage, taskId]);

  const uploadFiles = useCallback(async (files: File[], options?: { annotation?: string; parentId?: string; role?: TaskFileRole }) => {
    if (!canEdit || files.length === 0) return { success: false as const, error: "Cannot upload files" };
    onError?.(null);
    setIsUploading(true);
    try {
      let resolvedParentId = options?.parentId;
      if (!resolvedParentId && options?.annotation !== "#deliverable") {
        resolvedParentId = await getOrCreateTaskSystemFolderAction(projectId, taskId);
      }

      const collisions = await getUploadCollisionSummary(
        projectId,
        resolvedParentId ?? null,
        files.map((file) => file.name),
        { taskId },
      );
      if (!confirmUploadCollisions(collisions)) {
        return { success: false as const, error: "Upload cancelled" };
      }
      const filesToUpload = files.filter(
        (file) => !collisions.existingFiles.includes(file.name),
      );
      if (filesToUpload.length === 0) {
        return { success: true as const };
      }

      const results = await runWithConcurrency(filesToUpload, 3, (file) => uploadFile(file, {
        linkToTask: true,
        annotation: options?.annotation,
        parentId: resolvedParentId,
        role: options?.role ?? "working",
      }));
      const failed = results.filter((result) => !result.success);
      const succeeded = results.length - failed.length;
      if (succeeded > 0) await runAfterSuccess();
      if (failed.length > 0) {
        const firstFailure = failed[0]!;
        throw new Error(("error" in firstFailure && firstFailure.error) || `${failed.length} upload${failed.length === 1 ? "" : "s"} failed`);
      }
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      onError?.(message);
      return { success: false as const, error: message };
    } finally {
      setIsUploading(false);
    }
  }, [canEdit, onError, runAfterSuccess, uploadFile]);

  const uploadFolders = useCallback(async (folders: DroppedFolder[], options?: { role?: TaskFileRole; parentId?: string | null }) => {
    if (!canEdit || folders.length === 0) return { success: false as const, error: "Cannot upload folders" };
    onError?.(null);
    setIsUploading(true);
    let createdAnyFolder = false;
    try {
      const resolvedParentId = options?.parentId ?? await getOrCreateTaskSystemFolderAction(projectId, taskId);
      const uploadPaths = folders.flatMap((folder) =>
        folder.files.map((entry) => [folder.name, entry.relativePath || entry.file.name].filter(Boolean).join("/")),
      );
      const collisions = await getUploadCollisionSummary(
        projectId,
        resolvedParentId,
        uploadPaths,
        { taskId },
      );
      if (!confirmUploadCollisions(collisions)) {
        return { success: false as const, error: "Upload cancelled" };
      }
      const existingFiles = new Set(collisions.existingFiles);

      for (const folder of folders) {
        const role = options?.role ?? "working";
        const existingRootId = collisions.folderIdsByPath[folder.name];
        const rootFolder = existingRootId
          ? { id: existingRootId }
          : (await createFolder(projectId, resolvedParentId, folder.name, { taskId })) as Pick<ProjectNode, "id">;
        if (!existingRootId) {
          createdAnyFolder = true;
        }
        await linkNodeToTask(taskId, rootFolder.id, { role });

        const chainCache = new Map<string, string>();
        chainCache.set("", rootFolder.id);

        for (const entry of folder.files) {
          const segments = entry.relativePath.split("/");
          const filename = segments.pop() ?? entry.file.name;
          const key = segments.join("/");

          let parentId = chainCache.get(key);
          if (!parentId) {
            let currentParentId = rootFolder.id;
            for (let index = 0; index < segments.length; index += 1) {
              const segment = segments[index]!;
              const relativeFolderPath = [folder.name, ...segments.slice(0, index + 1)].join("/");
              const existingFolderId = collisions.folderIdsByPath[relativeFolderPath];
              if (existingFolderId) {
                currentParentId = existingFolderId;
                continue;
              }
              const created = (await createFolder(projectId, currentParentId, segment, { taskId })) as ProjectNode;
              currentParentId = created.id;
            }
            parentId = currentParentId;
            chainCache.set(key, parentId);
          }

          const fileObj = entry.file.name === filename ? entry.file : new File([entry.file], filename, { type: entry.file.type });
          const relativeFilePath = [folder.name, entry.relativePath || filename].filter(Boolean).join("/");
          if (existingFiles.has(relativeFilePath)) continue;
          const result = await uploadFile(fileObj, { parentId, taskOwned: true });
          if (!result.success) throw new Error(result.error);
          createdAnyFolder = true; // Also refresh successful files added to a reused folder.
        }
      }
      await runAfterSuccess();
      return { success: true as const };
    } catch (error) {
      if (createdAnyFolder) await runAfterSuccess();
      const message = error instanceof Error ? error.message : "Folder upload failed";
      onError?.(message);
      return { success: false as const, error: message };
    } finally {
      setIsUploading(false);
    }
  }, [canEdit, onError, projectId, runAfterSuccess, taskId, uploadFile]);

  const saveAsNewVersion = useCallback(async (nodeId: string, file: File, options?: { comment?: string | null }) => {
    if (!canEdit) return { success: false as const, error: "Forbidden" };
    onError?.(null);
    setIsUploading(true);
    try {
      const result = await saveFileAsNewVersionOrig({
        projectId,
        nodeId,
        file,
        comment: options?.comment || null,
        supabase,
      });

      if (!result.success) throw new Error(result.error);

      await runAfterSuccess();
      return { success: true as const, node: result.node as ProjectNode, version: result.version };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Version upload failed";
      onError?.(message);
      return { success: false as const, error: message };
    } finally {
      setIsUploading(false);
    }
  }, [canEdit, onError, projectId, runAfterSuccess, supabase]);

  const unlinkAttachment = useCallback(async (nodeId: string) => {
    if (!canEdit) return { success: false as const, error: "Forbidden" };
    onError?.(null);
    setAttachments((current) => current.filter((attachment) => attachment.id !== nodeId));
    try {
      await unlinkNodeFromTask(taskId, nodeId);
      await runAfterSuccess();
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to unlink file";
      onError?.(message);
      await refreshAttachments(); // Revert optimistic update
      return { success: false as const, error: message };
    }
  }, [canEdit, onError, refreshAttachments, runAfterSuccess, setAttachments, taskId]);

  return useMemo(() => ({
    uploadQueue: [] as TaskFileUploadStatus[],
    isUploading,
    pendingResolution: null,
    unresolvedReplacementCount: 0,
    unclassifiedUploadCount: 0,
    uploadFiles,
    uploadFolders,
    unlinkAttachment,
    resolvePendingResolution: async () => ({ success: false as const, error: "Removed" }),
    saveAsNewVersion,
    downloadAttachment: () => {}, // unused natively here typically
  }), [isUploading, saveAsNewVersion, unlinkAttachment, uploadFiles, uploadFolders]);
}
