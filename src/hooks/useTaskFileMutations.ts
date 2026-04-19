"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema";
import {
  createFileNode,
  createFolder,
  linkNodeToTask,
  unlinkNodeFromTask,
} from "@/app/actions/files";
import { getProjectNodes } from "@/app/actions/files/nodes";
import { replaceNodeWithNewVersion } from "@/app/actions/files/versions";
import { getUploadPresignedUrl } from "@/app/actions/upload";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { computeContentHash } from "@/lib/files/content-hash";
import type { DroppedFolder } from "@/lib/files/folder-drop";
import { topLevelChildNames } from "@/lib/files/folder-drop";
import {
  resolveTaskFileIntent,
  type TaskFileIntentResolution,
  type TaskFileResolutionChoice,
} from "@/lib/projects/task-file-intelligence";

export type TaskFileUploadStatus = {
  id: string;
  filename: string;
  progress: number;
  status: "uploading" | "awaiting_resolution" | "success" | "error";
  error?: string;
};

export type TaskFilePendingResolution = {
  id: string;
  source: "upload" | "existing";
  /**
   * Wave 3: distinguishes file uploads / existing-file attach attempts from
   * folder-drop resolutions. Folders use a different choice set and an
   * attached payload (`folderPayload`) describing the contents.
   */
  candidateType: "file" | "folder";
  candidateName: string;
  candidateNodeId: string | null;
  candidateNodeName: string | null;
  resolution: TaskFileIntentResolution;
  options: TaskFileResolutionChoice[];
  /**
   * Folder drops pass their normalized contents through the resolution
   * prompt; the hook consumes this once the user picks a choice.
   */
  folderPayload?: {
    rootName: string;
    entries: Array<{ file: File; relativePath: string }>;
  };
};

type UploadJob = {
  id: string;
  file: File;
};

function extOf(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function appendUploadSuffix(filename: string, suffix: number) {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return `${filename}-${suffix}`;
  return `${filename.slice(0, idx)}-${suffix}${filename.slice(idx)}`;
}

function resolutionOptionsFor(resolution: TaskFileIntentResolution) {
  if (resolution.intent === "replace_existing") {
    return ["replace", "attach_new", "cancel"] as TaskFileResolutionChoice[];
  }

  if (resolution.intent === "candidate_child_of_linked_folder") {
    return ["link_existing", "attach_new", "cancel"] as TaskFileResolutionChoice[];
  }

  if (resolution.intent === "ambiguous") {
    return ["attach_new", "cancel"] as TaskFileResolutionChoice[];
  }

  // Wave 3 folder intents — distinct choice ordering so the recommended
  // button surfaces first in the modal.
  if (resolution.intent === "folder_replace_existing") {
    return ["replace", "merge", "attach_new", "cancel"] as TaskFileResolutionChoice[];
  }

  if (resolution.intent === "folder_merge_into_existing") {
    return ["merge", "subfolder", "attach_new", "cancel"] as TaskFileResolutionChoice[];
  }

  if (resolution.intent === "folder_create_subfolder") {
    return ["subfolder", "attach_new", "cancel"] as TaskFileResolutionChoice[];
  }

  return ["attach_new", "cancel"] as TaskFileResolutionChoice[];
}

export function useTaskFileMutations(params: {
  projectId: string;
  taskId: string;
  canEdit: boolean;
  attachments: (ProjectNode & { annotation?: string | null })[];
  setAttachments: Dispatch<SetStateAction<ProjectNode[]>>;
  refreshAttachments: () => Promise<ProjectNode[]>;
  onError?: (message: string | null) => void;
  onAfterMutation?: () => Promise<void> | void;
}) {
  const {
    projectId,
    taskId,
    canEdit,
    attachments,
    setAttachments,
    refreshAttachments,
    onError,
    onAfterMutation,
  } = params;

  const supabase = useMemo(() => createClient(), []);
  const [uploadQueue, setUploadQueue] = useState<TaskFileUploadStatus[]>([]);
  const [pendingResolutions, setPendingResolutions] = useState<TaskFilePendingResolution[]>([]);
  const [unresolvedReplacementCount, setUnresolvedReplacementCount] = useState(0);
  const [unclassifiedUploadCount, setUnclassifiedUploadCount] = useState(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUploadJobsRef = useRef<Map<string, UploadJob>>(new Map());
  const pendingExistingNodesRef = useRef<Map<string, ProjectNode>>(new Map());
  const isUploading = uploadQueue.some((item) => item.status === "uploading");

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const notifyError = useCallback((message: string | null) => {
    onError?.(message);
  }, [onError]);

  const pendingResolution = pendingResolutions[0] ?? null;

  const updateStatus = useCallback((id: string, updates: Partial<TaskFileUploadStatus>) => {
    setUploadQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }, []);

  const clearPendingWarnings = useCallback(() => {
    setUnresolvedReplacementCount(0);
    setUnclassifiedUploadCount(0);
  }, []);

  const markDeferredResolution = useCallback((resolution: TaskFileIntentResolution) => {
    if (resolution.intent === "replace_existing") {
      setUnresolvedReplacementCount((current) => current + 1);
      return;
    }

    setUnclassifiedUploadCount((current) => current + 1);
  }, []);

  const loadIntentSearchMatches = useCallback(async (candidateName: string) => {
    const query = candidateName.trim();
    if (query.length < 2) return [] as ProjectNode[];
    const result = await getProjectNodes(projectId, null, query);
    return Array.isArray(result) ? result : result.nodes;
  }, [projectId]);

  const analyzeCandidate = useCallback(async (candidate: {
    name: string;
    node?: ProjectNode | null;
  }) => {
    const searchMatches = await loadIntentSearchMatches(candidate.name);
    return resolveTaskFileIntent({
      candidateName: candidate.name,
      candidateNode: candidate.node ?? null,
      attachments,
      searchMatches,
    });
  }, [attachments, loadIntentSearchMatches]);

  const handleDownload = useCallback(async (node: ProjectNode) => {
    if (!node.s3Key) return;

    try {
      const { data, error: urlError } = await supabase.storage
        .from("project-files")
        .createSignedUrl(node.s3Key, 3600);
      if (urlError) throw urlError;
      if (!data?.signedUrl) throw new Error("Failed to create download link");

      const anchor = document.createElement("a");
      anchor.href = data.signedUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.download = node.name;
      anchor.click();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Failed to create download link");
    }
  }, [notifyError, supabase.storage]);

  const runAfterSuccess = useCallback(async () => {
    clearPendingWarnings();
    await refreshAttachments();
    await onAfterMutation?.();
  }, [clearPendingWarnings, onAfterMutation, refreshAttachments]);

  const finalizeExistingLink = useCallback(async (nodeId: string, replaceNodeId?: string | null) => {
    await linkNodeToTask(taskId, nodeId);
    if (replaceNodeId && replaceNodeId !== nodeId && attachments.some((attachment) => attachment.id === replaceNodeId)) {
      await unlinkNodeFromTask(taskId, replaceNodeId);
    }
    await runAfterSuccess();
  }, [attachments, runAfterSuccess, taskId]);

  const uploadNewNode = useCallback(async (job: UploadJob, options: {
    parentId: string | null;
    linkToTask: boolean;
    replaceNodeId?: string | null;
  }) => {
    let storagePath: string | null = null;
    let createdNode: ProjectNode | null = null;

    try {
      const fileExt = extOf(job.file.name);
      const opaque = Math.random().toString(36).slice(2);
      storagePath = buildProjectFileKey(projectId, `${opaque}${fileExt ? `.${fileExt}` : ""}`);
      const contentType = job.file.type || "application/octet-stream";

      updateStatus(job.id, { progress: 20, status: "uploading", error: undefined });

      const uploadSession = await getUploadPresignedUrl(storagePath, contentType, job.file.size);
      if ("error" in uploadSession) {
        throw new Error(uploadSession.error || "Failed to prepare upload");
      }

      const uploadResponse = await fetch(uploadSession.url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: job.file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed (${uploadResponse.status})`);
      }

      updateStatus(job.id, { progress: 60 });

      let candidateName = job.file.name;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          createdNode = (await createFileNode(projectId, options.parentId, {
            name: candidateName,
            s3Key: storagePath,
            size: job.file.size,
            mimeType: contentType,
            uploadIntentId: uploadSession.uploadIntentId,
          })) as ProjectNode;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("already exists in this location")) {
            throw error;
          }
          candidateName = appendUploadSuffix(job.file.name, attempt + 1);
        }
      }

      if (!createdNode) {
        throw new Error("Failed to create attachment record");
      }

      updateStatus(job.id, { progress: 85 });

      if (options.linkToTask) {
        await linkNodeToTask(taskId, createdNode.id);
        if (options.replaceNodeId && options.replaceNodeId !== createdNode.id && attachments.some((attachment) => attachment.id === options.replaceNodeId)) {
          await unlinkNodeFromTask(taskId, options.replaceNodeId);
        }
      }

      updateStatus(job.id, { progress: 100, status: "success", error: undefined });
      await runAfterSuccess();
      return { success: true as const, node: createdNode };
    } catch (error) {
      if (!createdNode && storagePath) {
        await supabase.storage.from("project-files").remove([storagePath]).catch(() => null);
      }
      const message = error instanceof Error ? error.message : "Upload failed";
      updateStatus(job.id, { status: "error", error: message });
      notifyError(message);
      return { success: false as const, error: message };
    }
  }, [attachments, notifyError, projectId, runAfterSuccess, supabase.storage, taskId, updateStatus]);

  /**
   * Upload `file` as a NEW version of an existing node via
   * `replaceNodeWithNewVersion`. This path is used when the user drops a
   * modified file back into the Files tab and confirms "Save as new version"
   * — see `open-file-sessions.ts` for the detection flow. Unlike
   * `uploadNewNode`, this never creates a sibling node; it appends to
   * `file_versions` and bumps `project_nodes.current_version` atomically.
   *
   * Returns the mutated ProjectNode on success.
   */
  const saveAsNewVersion = useCallback(
    async (
      nodeId: string,
      file: File,
      options?: { comment?: string | null },
    ) => {
      if (!canEdit) return { success: false as const, error: "Forbidden" };
      notifyError(null);

      const jobId = Math.random().toString(36).slice(2, 9);
      setUploadQueue((current) => [
        ...current,
        {
          id: jobId,
          filename: file.name,
          progress: 0,
          status: "uploading",
        },
      ]);

      let storagePath: string | null = null;
      try {
        const fileExt = extOf(file.name);
        const opaque = Math.random().toString(36).slice(2);
        storagePath = buildProjectFileKey(
          projectId,
          `${opaque}${fileExt ? `.${fileExt}` : ""}`,
        );
        const contentType = file.type || "application/octet-stream";

        updateStatus(jobId, { progress: 15 });

        // Hash in parallel with the presigned-URL fetch — by the time the
        // PUT starts we'll have both. computeContentHash may return a
        // "prefix" result for > 4 MiB; we only forward "full" hashes to
        // the server to avoid polluting `file_versions.content_hash` with
        // non-SHA256 values.
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

        updateStatus(jobId, { progress: 70 });

        const contentHash =
          hashResult && hashResult.kind === "full" ? hashResult.hashHex : null;

        const result = await replaceNodeWithNewVersion({
          projectId,
          nodeId,
          s3Key: storagePath,
          size: file.size,
          mimeType: contentType,
          contentHash,
          uploadIntentId: uploadSession.uploadIntentId,
          comment: options?.comment ?? null,
        });

        updateStatus(jobId, { progress: 100, status: "success", error: undefined });
        await runAfterSuccess();

        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => {
          setUploadQueue((current) =>
            current.filter((item) => item.status !== "success"),
          );
        }, 3000);

        return { success: true as const, node: result.node, version: result.version };
      } catch (error) {
        // Best-effort orphan cleanup: replaceNodeWithNewVersion throws
        // BEFORE updating project_nodes if anything goes wrong, so the
        // just-uploaded blob is orphaned. Delete it. No-op if the blob
        // never made it to S3.
        if (storagePath) {
          await supabase.storage
            .from("project-files")
            .remove([storagePath])
            .catch(() => null);
        }
        const message = error instanceof Error ? error.message : "Upload failed";
        updateStatus(jobId, { status: "error", error: message });
        notifyError(message);
        return { success: false as const, error: message };
      }
    },
    [canEdit, notifyError, projectId, runAfterSuccess, supabase.storage, updateStatus],
  );

  const queuePendingResolution = useCallback((payload: TaskFilePendingResolution) => {
    setPendingResolutions((current) => [...current, payload]);
  }, []);

  // ---------------------------------------------------------------------
  // Wave 3 — folder drop orchestration
  // ---------------------------------------------------------------------

  /**
   * Resolve a relative directory path under `rootParentId`, creating
   * missing folders as we go. Returns the id of the deepest folder.
   *
   * Implemented with O(depth) round-trips: for each segment we list the
   * parent's children and either reuse an existing subfolder or create
   * one. Each depth gets one `getProjectNodes(parent)` call plus at most
   * one `createFolder(parent, name)` call. For a 20-file flat drop this
   * is ~2 requests total. A nested drop pays per level.
   */
  const ensureFolderChain = useCallback(
    async (rootParentId: string | null, segments: string[]) => {
      let currentParentId = rootParentId;
      for (const segment of segments) {
        const listing = await getProjectNodes(projectId, currentParentId);
        const children = Array.isArray(listing) ? listing : listing.nodes;
        const existing = children.find(
          (node) => node.type === "folder" && node.name === segment,
        );
        if (existing) {
          currentParentId = existing.id;
          continue;
        }
        const created = (await createFolder(projectId, currentParentId, segment)) as ProjectNode;
        currentParentId = created.id;
      }
      return currentParentId;
    },
    [projectId],
  );

  /**
   * Upload each entry under the given root parent, recreating the nested
   * directory structure implied by `relativePath`. Kept sequential so
   * folder-chain creation doesn't race on identical segments.
   */
  const uploadFolderEntries = useCallback(
    async (
      entries: Array<{ file: File; relativePath: string }>,
      rootParentId: string | null,
    ) => {
      // Cache folder chains we've already resolved so a 50-file flat folder
      // doesn't pay 50 `getProjectNodes` calls.
      const chainCache = new Map<string, string | null>();
      chainCache.set("", rootParentId);

      for (const entry of entries) {
        const segments = entry.relativePath.split("/");
        const filename = segments.pop() ?? entry.file.name;
        const key = segments.join("/");

        let parentId = chainCache.get(key) ?? null;
        if (!chainCache.has(key)) {
          parentId = await ensureFolderChain(rootParentId, segments);
          chainCache.set(key, parentId);
        }

        // Re-use the existing uploadNewNode pipeline but give it the file
        // under its correct filename (not the relativePath).
        const job: UploadJob = {
          id: Math.random().toString(36).slice(2, 9),
          file:
            entry.file.name === filename
              ? entry.file
              : new File([entry.file], filename, {
                  type: entry.file.type,
                  lastModified: entry.file.lastModified,
                }),
        };
        pendingUploadJobsRef.current.set(job.id, job);
        setUploadQueue((current) => [
          ...current,
          {
            id: job.id,
            filename,
            progress: 0,
            status: "uploading",
          },
        ]);
        // We link individual files only when they land at the top level
        // (no path segments). Nested files inherit linkage via their
        // containing folder, which the caller links explicitly.
        await uploadNewNode(job, {
          parentId,
          linkToTask: segments.length === 0 && !rootParentId,
        });
        pendingUploadJobsRef.current.delete(job.id);
      }
    },
    [ensureFolderChain, uploadNewNode],
  );

  const analyzeFolderCandidate = useCallback(
    (folder: DroppedFolder) => {
      return resolveTaskFileIntent({
        candidateName: folder.name,
        candidateType: "folder",
        candidateChildNames: topLevelChildNames(folder),
        attachments,
      });
    },
    [attachments],
  );

  const enqueueFolderJob = useCallback(
    async (folder: DroppedFolder) => {
      const resolution = analyzeFolderCandidate(folder);
      const jobId = Math.random().toString(36).slice(2, 9);
      setUploadQueue((current) => [
        ...current,
        {
          id: jobId,
          filename: `${folder.name}/ (${folder.files.length} files)`,
          progress: 0,
          status: resolution.requiresPrompt ? "awaiting_resolution" : "uploading",
        },
      ]);

      if (resolution.requiresPrompt) {
        queuePendingResolution({
          id: jobId,
          source: "upload",
          candidateType: "folder",
          candidateName: folder.name,
          candidateNodeId: null,
          candidateNodeName: null,
          resolution,
          options: resolutionOptionsFor(resolution),
          folderPayload: { rootName: folder.name, entries: folder.files },
        });
        return { success: true as const, jobId };
      }

      // No prompt needed → default to "attach as new folder at task root".
      try {
        updateStatus(jobId, { status: "uploading", progress: 20 });
        const rootFolder = (await createFolder(projectId, null, folder.name)) as ProjectNode;
        updateStatus(jobId, { progress: 50 });
        await uploadFolderEntries(folder.files, rootFolder.id);
        await linkNodeToTask(taskId, rootFolder.id);
        updateStatus(jobId, { progress: 100, status: "success", error: undefined });
        await runAfterSuccess();
        return { success: true as const, jobId };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Folder upload failed";
        updateStatus(jobId, { status: "error", error: message });
        notifyError(message);
        return { success: false as const, error: message };
      }
    },
    [
      analyzeFolderCandidate,
      notifyError,
      projectId,
      queuePendingResolution,
      runAfterSuccess,
      taskId,
      updateStatus,
      uploadFolderEntries,
    ],
  );

  const uploadFolders = useCallback(
    async (folders: DroppedFolder[]) => {
      if (!canEdit) return { success: false as const, error: "Forbidden" };
      if (folders.length === 0) return { success: true as const };
      notifyError(null);
      for (const folder of folders) {
        await enqueueFolderJob(folder);
      }
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setUploadQueue((current) => current.filter((item) => item.status !== "success"));
      }, 3000);
      return { success: true as const };
    },
    [canEdit, enqueueFolderJob, notifyError],
  );

  const enqueueUploadJob = useCallback(async (file: File) => {
    const job: UploadJob = {
      id: Math.random().toString(36).slice(2, 9),
      file,
    };

    pendingUploadJobsRef.current.set(job.id, job);
    setUploadQueue((current) => [
      ...current,
      {
        id: job.id,
        filename: file.name,
        progress: 0,
        status: "uploading",
      },
    ]);

    const resolution = await analyzeCandidate({ name: file.name });
    if (resolution.requiresPrompt) {
      updateStatus(job.id, {
        status: "awaiting_resolution",
        progress: 0,
        error: undefined,
      });
      queuePendingResolution({
        id: job.id,
        source: "upload",
        candidateType: "file",
        candidateName: file.name,
        candidateNodeId: null,
        candidateNodeName: null,
        resolution,
        options: resolutionOptionsFor(resolution),
      });
      return { success: true as const };
    }

    return uploadNewNode(job, {
      parentId: null,
      linkToTask: true,
    });
  }, [analyzeCandidate, queuePendingResolution, updateStatus, uploadNewNode]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length || !canEdit) {
      return { success: false as const, error: "Forbidden" };
    }

    notifyError(null);
    const results = await Promise.all(files.map((file) => enqueueUploadJob(file)));

    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      setUploadQueue((current) => current.filter((item) => item.status !== "success"));
    }, 3000);

    const firstFailure = results.find((result) => !result.success);
    if (firstFailure && "error" in firstFailure) {
      return { success: false as const, error: firstFailure.error };
    }

    return { success: true as const };
  }, [canEdit, enqueueUploadJob, notifyError]);

  const attachExisting = useCallback(async (node: ProjectNode) => {
    if (!canEdit) return { success: false as const, error: "Forbidden" };
    if (attachments.some((attachment) => attachment.id === node.id)) {
      return { success: true as const };
    }

    notifyError(null);
    const resolution = await analyzeCandidate({ name: node.name, node });
    if (resolution.requiresPrompt) {
      pendingExistingNodesRef.current.set(node.id, node);
      queuePendingResolution({
        id: node.id,
        source: "existing",
        candidateType: "file",
        candidateName: node.name,
        candidateNodeId: node.id,
        candidateNodeName: node.name,
        resolution,
        options: resolutionOptionsFor(resolution),
      });
      return { success: true as const };
    }

    try {
      await finalizeExistingLink(node.id);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to attach file";
      notifyError(message);
      return { success: false as const, error: message };
    }
  }, [analyzeCandidate, attachments, canEdit, finalizeExistingLink, notifyError, queuePendingResolution]);

  const unlinkAttachment = useCallback(async (nodeId: string) => {
    if (!canEdit) return { success: false as const, error: "Forbidden" };

    notifyError(null);
    const previous = attachments;
    setAttachments((current) => current.filter((attachment) => attachment.id !== nodeId));

    try {
      await unlinkNodeFromTask(taskId, nodeId);
      await runAfterSuccess();
      return { success: true as const };
    } catch (error) {
      setAttachments(previous);
      const message = error instanceof Error ? error.message : "Failed to unlink file";
      notifyError(message);
      return { success: false as const, error: message };
    }
  }, [attachments, canEdit, notifyError, runAfterSuccess, setAttachments, taskId]);

  const resolvePendingResolution = useCallback(async (choice: TaskFileResolutionChoice) => {
    const pending = pendingResolutions[0] ?? null;
    if (!pending) {
      return { success: false as const, error: "No pending file decision" };
    }

    setPendingResolutions((current) => current.slice(1));

    if (choice === "cancel") {
      markDeferredResolution(pending.resolution);
      if (pending.source === "upload") {
        updateStatus(pending.id, { status: "error", error: "Upload canceled" });
        pendingUploadJobsRef.current.delete(pending.id);
      } else if (pending.candidateNodeId) {
        pendingExistingNodesRef.current.delete(pending.candidateNodeId);
      }
      return { success: true as const };
    }

    try {
      // Wave 3 — folder-drop resolution. No per-file UploadJob is tracked
      // at this level; the payload on `pending` carries the whole folder.
      if (pending.source === "upload" && pending.candidateType === "folder") {
        const payload = pending.folderPayload;
        if (!payload) {
          throw new Error("Folder contents are no longer available");
        }

        const runFolderChoice = async () => {
          updateStatus(pending.id, { status: "uploading", progress: 20 });

          if (choice === "merge" || choice === "replace") {
            // Merge / replace target is the existing linked folder. For
            // "replace" we intentionally use the same destination but
            // overwrites happen at the per-file layer (existing sibling
            // names collide and either pop the file resolver prompt via
            // `createFileNode`'s unique-name check or get suffixed).
            const targetParent =
              pending.resolution.matchedNodeId ?? pending.resolution.linkedFolderId ?? null;
            if (!targetParent) {
              throw new Error("Merge target is no longer available");
            }
            updateStatus(pending.id, { progress: 50 });
            await uploadFolderEntries(payload.entries, targetParent);
          } else if (choice === "subfolder") {
            const parent = pending.resolution.linkedFolderId;
            if (!parent) {
              throw new Error("Parent folder is no longer available");
            }
            updateStatus(pending.id, { progress: 40 });
            const sub = (await createFolder(projectId, parent, payload.rootName)) as ProjectNode;
            updateStatus(pending.id, { progress: 60 });
            await uploadFolderEntries(payload.entries, sub.id);
          } else {
            // "attach_new" (default) — create a fresh top-level folder
            // under the project root and link it to the task.
            updateStatus(pending.id, { progress: 40 });
            const newRoot = (await createFolder(
              projectId,
              null,
              payload.rootName,
            )) as ProjectNode;
            updateStatus(pending.id, { progress: 60 });
            await uploadFolderEntries(payload.entries, newRoot.id);
            await linkNodeToTask(taskId, newRoot.id);
          }

          updateStatus(pending.id, { progress: 100, status: "success", error: undefined });
          await runAfterSuccess();
          if (successTimerRef.current) clearTimeout(successTimerRef.current);
          successTimerRef.current = setTimeout(() => {
            setUploadQueue((current) => current.filter((item) => item.status !== "success"));
          }, 3000);
        };

        await runFolderChoice();
        return { success: true as const };
      }

      if (pending.source === "upload") {
        const job = pendingUploadJobsRef.current.get(pending.id);
        if (!job) {
          throw new Error("Upload is no longer available");
        }

        if (choice === "replace") {
          const result = await uploadNewNode(job, {
            parentId: null,
            linkToTask: true,
            replaceNodeId: pending.resolution.matchedNodeId,
          });
          pendingUploadJobsRef.current.delete(pending.id);
          return result;
        }

        if (choice === "link_existing") {
          updateStatus(pending.id, {
            status: "success",
            progress: 100,
            error: undefined,
          });
          clearPendingWarnings();
          pendingUploadJobsRef.current.delete(pending.id);
          if (successTimerRef.current) clearTimeout(successTimerRef.current);
          successTimerRef.current = setTimeout(() => {
            setUploadQueue((current) => current.filter((item) => item.status !== "success"));
          }, 3000);
          return { success: true as const };
        }

        const result = await uploadNewNode(job, {
          parentId: null,
          linkToTask: true,
        });
        pendingUploadJobsRef.current.delete(pending.id);
        return result;
      }

      const existingNode = pending.candidateNodeId
        ? pendingExistingNodesRef.current.get(pending.candidateNodeId) ?? null
        : null;
      if (!existingNode) {
        throw new Error("The selected file is no longer available");
      }

      if (choice === "replace") {
        await finalizeExistingLink(existingNode.id, pending.resolution.matchedNodeId);
      } else if (choice === "link_existing") {
        clearPendingWarnings();
      } else {
        await finalizeExistingLink(existingNode.id);
      }

      pendingExistingNodesRef.current.delete(existingNode.id);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve file action";
      notifyError(message);
      return { success: false as const, error: message };
    }
  }, [
    clearPendingWarnings,
    finalizeExistingLink,
    markDeferredResolution,
    notifyError,
    pendingResolutions,
    projectId,
    runAfterSuccess,
    taskId,
    updateStatus,
    uploadFolderEntries,
    uploadNewNode,
  ]);

  return {
    uploadQueue,
    isUploading,
    pendingResolution,
    unresolvedReplacementCount,
    unclassifiedUploadCount,
    uploadFiles,
    uploadFolders,
    attachExisting,
    unlinkAttachment,
    resolvePendingResolution,
    saveAsNewVersion,
    clearPendingFileWarnings: clearPendingWarnings,
    downloadAttachment: handleDownload,
  };
}
