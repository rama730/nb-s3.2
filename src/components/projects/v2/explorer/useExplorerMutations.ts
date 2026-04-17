"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema";
import {
  bulkMoveNodes,
  bulkRestoreNodes,
  bulkTrashNodes,
  createFileNode,
  createFolder,
  renameNode,
  bulkCreateFolderTree,
} from "@/app/actions/files";
import { getBatchUploadUrls, getUploadPresignedUrl } from "@/app/actions/upload";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";

interface UseExplorerMutationsOptions {
  projectId: string;
  canEdit: boolean;
  selectedNode: ProjectNode | null;
  selectedFolderId: string | null | undefined;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  storeSelectedNodeIds: string[];
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setChildren: (projectId: string, parentId: string | null, childIds: string[]) => void;
  toggleExpanded: (projectId: string, folderId: string, expanded?: boolean) => void;
  setSelectedNode: (projectId: string, nodeId: string, folderId: string | null) => void;
  setSelectedNodeIds: (projectId: string, nodeIds: string[]) => void;
  loadFolderContent: (parentId: string | null, mode?: "append" | "refresh") => Promise<void>;
  onOpenFile: (node: ProjectNode) => void;
  onNodeDeleted?: (nodeId: string) => void;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  recordOperation: (operation: Omit<ExplorerOperation, "id" | "at">) => void;
}

export function useExplorerMutations({
  projectId,
  canEdit,
  selectedNode,
  selectedFolderId,
  nodesById,
  childrenByParentId,
  loadedChildren,
  storeSelectedNodeIds,
  upsertNodes,
  setChildren,
  toggleExpanded,
  setSelectedNode,
  setSelectedNodeIds,
  loadFolderContent,
  onOpenFile,
  onNodeDeleted,
  showToast,
  recordOperation,
}: UseExplorerMutationsOptions) {
  const [createDialog, setCreateDialog] = useState<
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
  >({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; nodes: ProjectNode[] }>({
    open: false,
    nodes: [],
  });
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean;
    nodes: ProjectNode[];
    targetFolderId: string | null;
  }>({ open: false, nodes: [], targetFolderId: null });
  const [renameState, setRenameState] = useState<{
    nodeId: string | null;
    value: string;
    original: string;
  }>({ nodeId: null, value: "", original: "" });

  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationInFlightKeysRef = useRef<Set<string>>(new Set());
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const runInMutationQueue = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = mutationQueueRef.current.then(fn, fn);
    mutationQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const runUniqueMutation = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
      if (mutationInFlightKeysRef.current.has(key)) return null;
      mutationInFlightKeysRef.current.add(key);
      try {
        return await runInMutationQueue(fn);
      } finally {
        mutationInFlightKeysRef.current.delete(key);
      }
    },
    [runInMutationQueue]
  );

  const uploadWithPresignedUrl = useCallback(
    async (key: string, file: Blob, contentType: string, sizeBytes: number) => {
      const presigned = await getUploadPresignedUrl(key, contentType, sizeBytes);
      if ("error" in presigned) {
        throw new Error(presigned.error || "Failed to prepare upload");
      }
      const response = await fetch(presigned.url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }
      return presigned;
    },
    []
  );

  const openCreate = useCallback(
    (kind: "file" | "folder") => {
      if (!canEdit) return;
      const parentId =
        selectedNode?.type === "folder"
          ? selectedNode.id
          : selectedNode?.parentId ?? selectedFolderId ?? null;
      setCreateDialog({ open: true, kind, parentId, name: "" });
    },
    [canEdit, selectedFolderId, selectedNode]
  );

  const openCreateInFolder = useCallback(
    (folderId: string | null, kind: "file" | "folder") => {
      if (!canEdit) return;
      if (folderId) {
        setSelectedNode(projectId, folderId, folderId);
        setSelectedNodeIds(projectId, [folderId]);
      }
      setCreateDialog({ open: true, kind, parentId: folderId, name: "" });
    },
    [canEdit, projectId, setSelectedNode, setSelectedNodeIds]
  );

  const confirmCreate = useCallback(async () => {
    if (!createDialog.open) return;
    const name = createDialog.name.trim();
    if (!name) return;
    if (!canEdit) return;

    const parentId = createDialog.parentId ?? null;
    const mutationKey = `create:${projectId}:${createDialog.kind}:${parentId ?? "root"}:${name.toLowerCase()}`;

    try {
      const createdNode = await runUniqueMutation(mutationKey, async () => {
        if (!loadedChildren[filesParentKey(parentId)]) {
          await loadFolderContent(parentId, "refresh");
        }
        const siblingIds = childrenByParentId[filesParentKey(parentId)] || [];
        const siblings = siblingIds.map((id) => nodesById[id]).filter(Boolean);
        const dup = siblings.some((s) => s.name.toLowerCase() === name.toLowerCase());
        if (dup) throw new Error("A file/folder with that name already exists here.");

        if (createDialog.kind === "folder") {
          return (await createFolder(projectId, parentId, name)) as ProjectNode;
        }

        const fileExt = name.includes(".") ? name.split(".").pop() : "txt";
        const storagePath = buildProjectFileKey(projectId, `${Math.random().toString(36).substring(2)}.${fileExt}`);
        const emptyBlob = new Blob([""], { type: "text/plain" });
        const uploadSession = await uploadWithPresignedUrl(storagePath, emptyBlob, "text/plain", emptyBlob.size);

        return (await createFileNode(projectId, parentId, {
          name,
          s3Key: storagePath,
          size: 0,
          mimeType: "text/plain",
          uploadIntentId: uploadSession.uploadIntentId,
        })) as ProjectNode;
      });

      if (!createdNode) return;
      upsertNodes(projectId, [createdNode]);
      const parentKey = filesParentKey(parentId);
      const currentChildren = childrenByParentId[parentKey] || [];
      if (!currentChildren.includes(createdNode.id)) {
        setChildren(projectId, parentId, [...currentChildren, createdNode.id]);
      }

      if (parentId) toggleExpanded(projectId, parentId, true);
      showToast("Created", "success");
      recordOperation({
        label: `Created ${createDialog.kind} ${createdNode.name}`,
        status: "success",
        undo: canEdit
          ? {
            label: "Undo",
            run: async () => {
              await bulkTrashNodes([createdNode.id], projectId);
              useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, createdNode.id);
              await loadFolderContent(parentId, "refresh");
            },
          }
          : undefined,
      });
      setCreateDialog({ open: false });
    } catch (e: unknown) {
      showToast(`Create failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: `Create failed (${createDialog.kind})`,
        status: "error",
      });
    }
  }, [
    canEdit,
    childrenByParentId,
    createDialog,
    loadedChildren,
    loadFolderContent,
    nodesById,
    projectId,
    recordOperation,
    runUniqueMutation,
    setChildren,
    showToast,
    toggleExpanded,
    uploadWithPresignedUrl,
    upsertNodes,
  ]);

  const openUpload = useCallback(
    (parentId: string | null) => {
      if (!canEdit) return;
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        const mutationKey = `upload:${projectId}:${parentId ?? "root"}:${files
          .map((f) => f.name)
          .sort()
          .join(",")}`;
        try {
          const result = await runUniqueMutation(mutationKey, async () => {
            const supabase = getSupabase();
            const createdNodes: ProjectNode[] = [];
            let failed = 0;
            const uploadConcurrency = Math.max(1, FILES_RUNTIME_BUDGETS.saveAllConcurrency);
            const uploadPlans = files.map((file) => {
              const ext = file.name.split(".").pop() || "bin";
              const fileName = `${Math.random().toString(36).slice(2)}.${ext}`;
              return {
                file,
                filePath: buildProjectFileKey(projectId, fileName),
                contentType: file.type || "application/octet-stream",
                sizeBytes: file.size,
              };
            });

            const presignedBatch = await getBatchUploadUrls(
              uploadPlans.map((item) => ({
                key: item.filePath,
                contentType: item.contentType,
                sizeBytes: item.sizeBytes,
              }))
            );

            if ("error" in presignedBatch) {
              throw new Error(presignedBatch.error || "Failed to prepare upload URLs");
            }
            const uploadUrlMap = presignedBatch.urls || {};
            const uploadIntentIdMap = presignedBatch.uploadIntentIds || {};

            await runWithConcurrency(uploadPlans, uploadConcurrency, async ({ file, filePath, contentType, sizeBytes }) => {
              try {
                const uploadSession =
                  uploadUrlMap[filePath] ||
                  (
                    await getUploadPresignedUrl(filePath, contentType, sizeBytes)
                  );

                const resolvedUploadUrl =
                  typeof uploadSession === "string"
                    ? uploadSession
                    : "error" in uploadSession
                      ? null
                      : uploadSession.url;
                const resolvedUploadIntentId =
                  typeof uploadSession === "string"
                    ? uploadIntentIdMap[filePath] ?? null
                    : "error" in uploadSession
                      ? null
                      : uploadSession.uploadIntentId;

                if (!resolvedUploadUrl) {
                  throw new Error("Failed to prepare upload URL");
                }

                const uploadResponse = await fetch(resolvedUploadUrl, {
                  method: "PUT",
                  headers: { "Content-Type": contentType },
                  body: file,
                });
                if (!uploadResponse.ok) {
                  throw new Error(`Upload failed (${uploadResponse.status})`);
                }

                const node = (await createFileNode(projectId, parentId, {
                  name: file.name,
                  s3Key: filePath,
                  size: file.size,
                  mimeType: contentType,
                  uploadIntentId: resolvedUploadIntentId ?? undefined,
                })) as ProjectNode;
                createdNodes.push(node);
              } catch {
                await supabase.storage.from("project-files").remove([filePath]).catch(() => null);
                failed += 1;
              }
            });

            if (createdNodes.length > 0) {
              upsertNodes(projectId, createdNodes);
              const parentKey = filesParentKey(parentId);
              const currentChildren = childrenByParentId[parentKey] || [];
              const nextChildren = [...currentChildren];
              for (const node of createdNodes) {
                if (!nextChildren.includes(node.id)) nextChildren.push(node.id);
              }
              setChildren(projectId, parentId, nextChildren);

              if (parentId) toggleExpanded(projectId, parentId, true);
              await loadFolderContent(parentId, "refresh");
            }

            return { createdNodes, failed };
          });

          if (!result) return;
          const { createdNodes, failed } = result;
          if (createdNodes.length > 0) {
            onOpenFile(createdNodes[0]);
            const msg =
              failed > 0
                ? `Uploaded ${createdNodes.length} file(s), ${failed} failed`
                : `Uploaded ${createdNodes.length} file(s)`;
            showToast(msg, failed > 0 ? "info" : "success");
            recordOperation({
              label: msg,
              status: failed > 0 ? "error" : "success",
            });
          } else {
            showToast("Upload failed", "error");
            recordOperation({ label: "Upload failed", status: "error" });
          }
        } catch (e: unknown) {
          showToast(`Upload failed: ${getErrorMessage(e, "Unknown error")}`, "error");
          recordOperation({ label: "Upload failed", status: "error" });
        }
      };
      input.click();
    },
    [
      canEdit,
      childrenByParentId,
      getSupabase,
      loadFolderContent,
      onOpenFile,
      projectId,
      recordOperation,
      runUniqueMutation,
      setChildren,
      showToast,
      toggleExpanded,
      upsertNodes,
    ]
  );

  const openFolderUpload = useCallback(
    (parentId: string | null) => {
      if (!canEdit) return;
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.multiple = true;

      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        const mappedFiles: { path: string; fileId: string; s3Key: string; name: string }[] = [];
        try {
          showToast(`Scanning ${files.length} structural files...`, "info");
          const payloadNodes = files
            .map((f) => ({
              path: f.webkitRelativePath || f.name,
              name: f.name,
              size: f.size,
              mimeType: f.type || "application/octet-stream"
            }))
            .filter((node) => {
              // Pure optimization: silently discard system clutter that explodes DB rows
              if (node.name === ".DS_Store" || node.path.includes("__MACOSX") || node.path.includes("/.git/")) return false;
              return true;
            });

          if (payloadNodes.length === 0) return;

          // 1. O(depth) Bulk Upsert to build entire structure layout & reserve s3 keys
          // We chunk the payload to prevent Next.js 413 Payload Too Large errors
          const CHUNK_SIZE = 2000;

          for (let i = 0; i < payloadNodes.length; i += CHUNK_SIZE) {
            const chunk = payloadNodes.slice(i, i + CHUNK_SIZE);
            if (payloadNodes.length > CHUNK_SIZE) {
              showToast(`Registering database nodes ${i + 1} to ${Math.min(i + CHUNK_SIZE, payloadNodes.length)}...`, "info");
            }
            const mappedChunk = await bulkCreateFolderTree(projectId, parentId, chunk);
            if (mappedChunk) {
              mappedFiles.push(...mappedChunk);
            }
          }
          if (mappedFiles.length === 0) return;

          const mappingByPath = new Map(mappedFiles.map((entry) => [entry.path, entry]));
          const uploadNodes = files
            .map((file) => {
              const mapping = mappingByPath.get(file.webkitRelativePath || file.name);
              if (!mapping) return null;
              return { file, s3Key: mapping.s3Key, fileId: mapping.fileId, path: mapping.path };
            })
            .filter((item): item is { file: File; s3Key: string; fileId: string; path: string } => item !== null);

          if (uploadNodes.length === 0) {
            showToast("No eligible files found for upload.", "warning");
            return;
          }

          // 2. Pre-generate signed upload URLs in chunks (server-side validation applied)
          const presignedUploadUrls: Record<string, string> = {};
          const PRESIGN_CHUNK_SIZE = 200;
          for (let i = 0; i < uploadNodes.length; i += PRESIGN_CHUNK_SIZE) {
            const chunk = uploadNodes.slice(i, i + PRESIGN_CHUNK_SIZE);
            const batch = await getBatchUploadUrls(
              chunk.map((entry) => ({
                key: entry.s3Key,
                contentType: entry.file.type || "application/octet-stream",
                sizeBytes: entry.file.size,
              }))
            );
            if ("error" in batch) {
              throw new Error(batch.error || "Failed to prepare folder upload URLs");
            }
            Object.assign(presignedUploadUrls, batch.urls || {});
          }

          // 3. Connect to Web Worker to bypass main JS loop limits
          const performCleanup = async (w?: Worker) => {
            if (w) w.terminate();
            if (mappedFiles.length > 0) {
              const fileIds = mappedFiles.map((m) => m.fileId);
              try {
                await bulkTrashNodes(fileIds, projectId);
              } catch (cleanupError) {
                console.warn("Failed to cleanup upload placeholders", cleanupError);
              }
            }
          };

          const worker = new Worker(new URL('./upload.worker.ts', import.meta.url));
          const uploadJobId =
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

          showToast(`Uploading ${uploadNodes.length} items in background UI daemon...`, "info");

          worker.postMessage({
            jobId: uploadJobId,
            uploadNodes,
            uploadUrls: presignedUploadUrls,
          });

          worker.onmessage = async (e) => {
            if (e.data?.jobId && e.data.jobId !== uploadJobId) return;

            if (e.data.type === "error") {
              await performCleanup(worker);
              showToast(`Folder upload failed: ${e.data.message || "Unexpected worker error"}`, "error");
              recordOperation({ label: "Folder upload failed (worker error)", status: "error" });
              return;
            }

            if (e.data.type === "done") {
              worker.terminate();
              const failedFileIds = Array.isArray(e.data.results)
                ? e.data.results
                  .filter((result: { fileId?: string; success?: boolean }) => result?.success === false && !!result?.fileId)
                  .map((result: { fileId: string }) => result.fileId)
                : [];

              if (failedFileIds.length > 0) {
                try {
                  await bulkTrashNodes(failedFileIds, projectId);
                } catch (cleanupError) {
                  console.warn("Failed to cleanup failed upload placeholders", cleanupError);
                }
              }

              if (e.data.failed > 0) {
                showToast(`Folder uploaded with ${e.data.failed} errors.`, "warning");
                recordOperation({ label: `Folder partial upload: ${e.data.failed} failed`, status: "error" });
              } else {
                showToast(`Successfully uploaded folder (${e.data.success} files).`, "success");
                recordOperation({ label: `Folder upload: ${e.data.success} files`, status: "success" });
              }
              // Let React refresh the entire directory tree safely
              loadFolderContent(parentId, "refresh").then(() => {
                if (parentId) toggleExpanded(projectId, parentId, true);
              });
            }
          };

          worker.onerror = (err) => {
            void performCleanup(worker);
            showToast("Fatal upload worker process error", "error");
            recordOperation({ label: "Folder upload failed (worker crash)", status: "error" });
          };

        } catch (err) {
          // Note: performCleanup is defined inside try, but if it fails before worker creation, 
          // we might still need to cleanup mappedFiles if they were created.
          // However, mappedFiles is in scope here.
          if (typeof mappedFiles !== 'undefined' && mappedFiles.length > 0) {
            const fileIds = mappedFiles.map((m) => m.fileId);
            await bulkTrashNodes(fileIds, projectId).catch(() => null);
          }
          showToast(`Upload failed: ${getErrorMessage(err, "Unknown error")}`, "error");
        }
      };

      input.click();
    },
    [
      canEdit,
      loadFolderContent,
      projectId,
      recordOperation,
      showToast,
      toggleExpanded
    ]
  );

  const openRename = useCallback(
    (node: ProjectNode) => {
      if (!canEdit) return;
      setRenameState({ nodeId: node.id, value: node.name, original: node.name });
    },
    [canEdit]
  );

  const confirmRename = useCallback(async () => {
    if (!renameState.nodeId) return;
    if (!canEdit) return;
    const node = nodesById[renameState.nodeId];
    if (!node) {
      setRenameState({ nodeId: null, value: "", original: "" });
      return;
    }

    const nextName = renameState.value.trim();
    if (!nextName) {
      showToast("Name is required", "error");
      return;
    }
    if (nextName === renameState.original) {
      setRenameState({ nodeId: null, value: "", original: "" });
      return;
    }

    const siblingIds = childrenByParentId[filesParentKey(node.parentId ?? null)] || [];
    const duplicateSibling = siblingIds
      .map((id) => nodesById[id])
      .filter(Boolean)
      .some((s) => s.id !== node.id && s.name.toLowerCase() === nextName.toLowerCase());
    if (duplicateSibling) {
      showToast("A file/folder with that name already exists here.", "error");
      return;
    }

    const mutationKey = `rename:${projectId}:${node.id}:${nextName.toLowerCase()}`;
    try {
      const updated = await runUniqueMutation(mutationKey, async () => {
        return (await renameNode(node.id, nextName, projectId)) as ProjectNode;
      });
      if (!updated) return;
      upsertNodes(projectId, [updated]);
      setRenameState({ nodeId: null, value: "", original: "" });
      showToast("Renamed", "success");
      recordOperation({
        label: `Renamed ${renameState.original} -> ${nextName}`,
        status: "success",
        undo: {
          label: "Undo",
          run: async () => {
            const reverted = (await renameNode(node.id, renameState.original, projectId)) as ProjectNode;
            upsertNodes(projectId, [reverted]);
          },
        },
      });
    } catch (e: unknown) {
      showToast(`Rename failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: `Rename failed (${renameState.original})`,
        status: "error",
      });
    }
  }, [
    canEdit,
    childrenByParentId,
    nodesById,
    projectId,
    recordOperation,
    renameState,
    runUniqueMutation,
    showToast,
    upsertNodes,
  ]);

  const resolveActionNodes = useCallback(
    (node: ProjectNode) => {
      const currentSelected = useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
      if (currentSelected.length > 1 && currentSelected.includes(node.id)) {
        return currentSelected.map((id) => nodesById[id]).filter(Boolean) as ProjectNode[];
      }
      return [node];
    },
    [nodesById, projectId]
  );

  const openDelete = useCallback(
    (nodeOrNodes: ProjectNode | ProjectNode[]) => {
      if (!canEdit) return;
      const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
      setDeleteDialog({ open: true, nodes });
    },
    [canEdit]
  );

  const openMove = useCallback(
    (nodeOrNodes: ProjectNode | ProjectNode[]) => {
      if (!canEdit) return;
      const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
      setMoveDialog({ open: true, nodes, targetFolderId: null });
    },
    [canEdit]
  );

  const confirmMove = useCallback(async () => {
    const nodes = moveDialog.nodes;
    if (!nodes.length || !canEdit) return;

    const target = moveDialog.targetFolderId;

    for (const node of nodes) {
      if (target === node.id) {
        showToast(`Can't move ${node.name} into itself.`, "error");
        return;
      }
      if (node.type === "folder" && target) {
        let cur: string | null = target;
        for (let i = 0; i < 50; i++) {
          if (!cur) break;
          if (cur === node.id) {
            showToast(`Can't move ${node.name} into its own descendant.`, "error");
            return;
          }
          cur = nodesById[cur]?.parentId ?? null;
        }
      }
    }

    const nodeIds = nodes.map((n) => n.id).sort();
    const originalParentByNode = new Map<string, string | null>(
      nodes.map((node) => [node.id, node.parentId ?? null])
    );
    const mutationKey = `move:${projectId}:${target ?? "root"}:${nodeIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const node of nodes) {
          const oldParentId = node.parentId ?? null;
          if (oldParentId !== target) staleParents.add(oldParentId);
        }

        const updatedNodes = (await bulkMoveNodes(nodeIds, target, projectId)) as ProjectNode[];
        if (updatedNodes.length > 0) upsertNodes(projectId, updatedNodes);

        await Promise.all(Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh")));
        await loadFolderContent(target ?? null, "refresh");
        if (target) toggleExpanded(projectId, target, true);
        return updatedNodes;
      });

      if (result === null) return;
      const movedCount = result.length;
      showToast(`Moved ${movedCount} item${movedCount === 1 ? "" : "s"}`, "success");
      recordOperation({
        label: `Moved ${movedCount} item${movedCount === 1 ? "" : "s"}`,
        status: "success",
        undo: movedCount
          ? {
            label: "Undo",
            run: async () => {
              const groupedByParent: Record<string, string[]> = {};
              for (const [id, parentId] of originalParentByNode.entries()) {
                const key = parentId ?? "__root__";
                if (!groupedByParent[key]) groupedByParent[key] = [];
                groupedByParent[key].push(id);
              }
              for (const [parentKey, ids] of Object.entries(groupedByParent)) {
                const parentId = parentKey === "__root__" ? null : parentKey;
                if (ids.length > 0) {
                  await bulkMoveNodes(ids, parentId, projectId);
                  await loadFolderContent(parentId, "refresh");
                }
              }
              if (target !== null) await loadFolderContent(target, "refresh");
              else await loadFolderContent(null, "refresh");
            },
          }
          : undefined,
      });
      setMoveDialog({ open: false, nodes: [], targetFolderId: null });
    } catch (e: unknown) {
      showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({ label: "Move failed", status: "error" });
    }
  }, [canEdit, loadFolderContent, moveDialog, nodesById, projectId, recordOperation, runUniqueMutation, showToast, toggleExpanded, upsertNodes]);

  const confirmDelete = useCallback(async () => {
    const nodes = deleteDialog.nodes;
    if (!nodes.length || !canEdit) return;

    const nodeIds = nodes.map((n) => n.id).sort();
    const mutationKey = `trash:${projectId}:${nodeIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const node of nodes) staleParents.add(node.parentId ?? null);

        const response = await bulkTrashNodes(nodeIds, projectId);
        const trashedIds: string[] = response.trashedIds || [];

        for (const nodeId of trashedIds) {
          useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, nodeId);
          onNodeDeleted?.(nodeId);
        }

        await Promise.all(Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh")));
        return trashedIds.length;
      });

      if (result === null) return;
      showToast(`Moved ${result} item${result === 1 ? "" : "s"} to Trash`, "success");
      recordOperation({
        label: `Moved ${result} item${result === 1 ? "" : "s"} to trash`,
        status: "success",
        undo: result
          ? {
            label: "Undo",
            run: async () => {
              await bulkRestoreNodes(nodeIds, projectId);
              const staleParents = new Set<string | null>();
              for (const node of nodes) staleParents.add(node.parentId ?? null);
              await Promise.all(
                Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh"))
              );
            },
          }
          : undefined,
      });
      setDeleteDialog({ open: false, nodes: [] });
    } catch (e: unknown) {
      showToast(`Delete failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({ label: "Move to trash failed", status: "error" });
    }
  }, [canEdit, deleteDialog.nodes, loadFolderContent, onNodeDeleted, projectId, recordOperation, runUniqueMutation, showToast]);

  const handleMoveFromMenu = useCallback(
    (node: ProjectNode) => {
      openMove(resolveActionNodes(node));
    },
    [openMove, resolveActionNodes]
  );

  const handleDeleteFromMenu = useCallback(
    (node: ProjectNode) => {
      openDelete(resolveActionNodes(node));
    },
    [openDelete, resolveActionNodes]
  );

  const handleUploadToFolder = useCallback(
    (folderId: string | null) => {
      if (!canEdit) return;
      openUpload(folderId);
    },
    [canEdit, openUpload]
  );

  const handleDownloadFolder = useCallback(
    async (folderId: string | null) => {
      showToast("Preparing secure download channels...", "info");
      const supabase = getSupabase();

      const flatFilePaths: string[] = [];
      const visitedFolderIds = new Set<string>();
      const ensureFolderChildrenLoaded = async (pid: string | null) => {
        const key = filesParentKey(pid);
        let refreshAttempts = 0;
        let appendPasses = 0;
        while (true) {
          const ws = useFilesWorkspaceStore.getState().byProjectId[projectId];
          const childIds = ws?.childrenByParentId?.[key];
          const isLoaded = !!ws?.loadedChildren?.[key];
          const hasMore = !!ws?.folderMeta?.[key]?.hasMore;
          const hasChildrenList = Array.isArray(childIds);

          if (!isLoaded || !hasChildrenList) {
            if (refreshAttempts >= 1) break;
            refreshAttempts += 1;
            await loadFolderContent(pid, "refresh");
            continue;
          }

          if (hasMore) {
            if (appendPasses >= 100) break;
            appendPasses += 1;
            await loadFolderContent(pid, "append");
            continue;
          }
          break;
        }
      };

      const walkForPaths = async (pid: string | null): Promise<void> => {
        const folderVisitKey = pid ?? "__root__";
        if (visitedFolderIds.has(folderVisitKey)) return;
        visitedFolderIds.add(folderVisitKey);
        await ensureFolderChildrenLoaded(pid);

        const ws = useFilesWorkspaceStore.getState().byProjectId[projectId];
        const childIds = ws?.childrenByParentId?.[filesParentKey(pid)] || [];
        for (const id of childIds) {
          const node = ws?.nodesById?.[id];
          if (!node) continue;
          if (node.type === "file" && node.s3Key) {
            flatFilePaths.push(node.s3Key);
          } else if (node.type === "folder") {
            await walkForPaths(node.id);
          }
        }
      };
      await walkForPaths(folderId);

      const latestWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      const latestNodesById = latestWs?.nodesById ?? nodesById;
      const latestChildrenByParentId = latestWs?.childrenByParentId ?? childrenByParentId;

      if (flatFilePaths.length === 0) {
        showToast("No files to download", "warning");
        return;
      }

      // 1-Hour Presigned URLs bypass RLS limits for pure client-side zipping
      const { data: signedUrlData, error } = await supabase.storage
        .from("project-files")
        .createSignedUrls(flatFilePaths, 3600);

      if (error || !signedUrlData) {
        showToast("Failed to generate secure download tokens", "error");
        return;
      }

      const signedUrlMap: Record<string, string> = {};
      const nodeIdByS3Key = new Map<string, string>();
      for (const node of Object.values(latestNodesById)) {
        if (node.s3Key) nodeIdByS3Key.set(node.s3Key, node.id);
      }

      // Re-map the S3 Keys to their Node IDs for the worker
      for (const signed of signedUrlData) {
        if (signed.error) continue;
        const matchingNodeId = nodeIdByS3Key.get(signed.path);
        if (matchingNodeId) signedUrlMap[matchingNodeId] = signed.signedUrl;
      }

      showToast("Starting client-side ZIP compilation...", "success");

      const worker = new Worker(new URL('./utils/download.worker.ts', import.meta.url));

      worker.onmessage = (e: MessageEvent<any>) => {
        const result = e.data;
        if (result.error) {
          showToast(`Download failed: ${result.error}`, "error");
          worker.terminate();
        } else if (result.blob) {
          const url = URL.createObjectURL(result.blob);
          const a = document.createElement("a");
          a.href = url;

          const rootNodeName = folderId && latestNodesById[folderId] ? latestNodesById[folderId].name : "Project Files";
          a.download = `${rootNodeName}_Export.zip`;

          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showToast("Folder downloaded successfully!", "success");
          worker.terminate();
        } else if (result.progress) {
          // Can be hooked into global progress monitor if needed
        }
      };

      worker.postMessage({
          jobId: `dl-${folderId || "root"}`,
          projectId,
          projectName: "Project Files",
          nodesById: latestNodesById,
          childrenByParentId: latestChildrenByParentId,
          targetFolderId: folderId,
          signedUrls: signedUrlMap
        });

    },
    [childrenByParentId, nodesById, getSupabase, loadFolderContent, projectId, showToast]
  );

  // Direct file upload (for desktop drag-and-drop — no picker dialog)
  const uploadFilesDirectly = useCallback(
    async (files: File[], parentId: string | null) => {
      if (!canEdit || files.length === 0) return;

      const mutationKey = `upload-direct:${projectId}:${parentId ?? "root"}:${files
        .map((f) => f.name)
        .sort()
        .join(",")}`;
      try {
        const result = await runUniqueMutation(mutationKey, async () => {
          const supabase = getSupabase();
          const createdNodes: ProjectNode[] = [];
          let failed = 0;
          const uploadPlans = files.map((file) => {
            const ext = file.name.split(".").pop() || "bin";
            const fileName = `${Math.random().toString(36).slice(2)}.${ext}`;
            return {
              file,
              filePath: buildProjectFileKey(projectId, fileName),
              contentType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            };
          });

          const presignedBatch = await getBatchUploadUrls(
            uploadPlans.map((item) => ({
              key: item.filePath,
              contentType: item.contentType,
              sizeBytes: item.sizeBytes,
            }))
          );
          if ("error" in presignedBatch) {
            throw new Error(presignedBatch.error || "Failed to prepare upload URLs");
          }
          const uploadUrlMap = presignedBatch.urls || {};
          const uploadIntentIdMap = presignedBatch.uploadIntentIds || {};

          for (const { file, filePath, contentType, sizeBytes } of uploadPlans) {
            try {
              const uploadSession =
                uploadUrlMap[filePath] ||
                (
                  await getUploadPresignedUrl(filePath, contentType, sizeBytes)
                );

              const resolvedUploadUrl =
                typeof uploadSession === "string"
                  ? uploadSession
                  : "error" in uploadSession
                    ? null
                    : uploadSession.url;
              const resolvedUploadIntentId =
                typeof uploadSession === "string"
                  ? uploadIntentIdMap[filePath] ?? null
                  : "error" in uploadSession
                    ? null
                    : uploadSession.uploadIntentId;

              if (!resolvedUploadUrl) {
                throw new Error("Failed to prepare upload URL");
              }

              const uploadResponse = await fetch(resolvedUploadUrl, {
                method: "PUT",
                headers: { "Content-Type": contentType },
                body: file,
              });
              if (!uploadResponse.ok) {
                throw new Error(`Upload failed (${uploadResponse.status})`);
              }

              const node = (await createFileNode(projectId, parentId, {
                name: file.name,
                s3Key: filePath,
                size: file.size,
                mimeType: contentType,
                uploadIntentId: resolvedUploadIntentId ?? undefined,
              })) as ProjectNode;
              createdNodes.push(node);
            } catch {
              await supabase.storage.from("project-files").remove([filePath]).catch(() => null);
              failed += 1;
            }
          }

          if (createdNodes.length > 0) {
            upsertNodes(projectId, createdNodes);
            const parentKey = filesParentKey(parentId);
            const currentChildren = childrenByParentId[parentKey] || [];
            const nextChildren = [...currentChildren];
            for (const node of createdNodes) {
              if (!nextChildren.includes(node.id)) nextChildren.push(node.id);
            }
            setChildren(projectId, parentId, nextChildren);

            if (parentId) toggleExpanded(projectId, parentId, true);
            await loadFolderContent(parentId, "refresh");
          }

          return { createdNodes, failed };
        });

        if (!result) return;
        const { createdNodes, failed } = result;
        if (createdNodes.length > 0) {
          onOpenFile(createdNodes[0]);
          const msg =
            failed > 0
              ? `Uploaded ${createdNodes.length} file(s), ${failed} failed`
              : `Uploaded ${createdNodes.length} file(s)`;
          showToast(msg, failed > 0 ? "info" : "success");
          recordOperation({
            label: msg,
            status: failed > 0 ? "error" : "success",
          });
        } else {
          showToast("Upload failed", "error");
          recordOperation({ label: "Upload failed", status: "error" });
        }
      } catch (e: unknown) {
        showToast(`Upload failed: ${getErrorMessage(e, "Unknown error")}`, "error");
        recordOperation({ label: "Upload failed", status: "error" });
      }
    },
    [
      canEdit,
      childrenByParentId,
      getSupabase,
      loadFolderContent,
      onOpenFile,
      projectId,
      recordOperation,
      runUniqueMutation,
      setChildren,
      showToast,
      toggleExpanded,
      upsertNodes,
    ]
  );

  return {
    createDialog,
    setCreateDialog,
    deleteDialog,
    setDeleteDialog,
    moveDialog,
    setMoveDialog,
    renameState,
    setRenameState,
    openCreate,
    openCreateInFolder,
    confirmCreate,
    openUpload,
    openFolderUpload,
    openRename,
    confirmRename,
    resolveActionNodes,
    openDelete,
    openMove,
    confirmMove,
    confirmDelete,
    handleMoveFromMenu,
    handleDeleteFromMenu,
    handleUploadToFolder,
    handleDownloadFolder,
    uploadFilesDirectly,
    runUniqueMutation,
  };
}
