"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema";
import {
  moveProjectNodes,
  bulkRestoreNodes,
  bulkTrashNodes,
  createFileNode,
  createFolder,
  renameNode,
  bulkCreateFolderTree,
  getUploadCollisionSummary,
} from "@/app/actions/files/mutations";
import { getBatchUploadUrls, getUploadPresignedUrl } from "@/app/actions/upload";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { planUploadCopyNames, selectUploadFiles } from "@/lib/files/upload-collisions";
import { useUploadCollisionDecision } from "./useUploadCollisionDecision";
import { useFileTransfers } from "../files-tab/FileTransfers";

interface UseExplorerMutationsOptions {
  projectId: string;
  canEdit: boolean;
  canManageFiles?: boolean;
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
  canManageFiles = canEdit,
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
  const { chooseUploadCollision, uploadCollisionDialog } = useUploadCollisionDecision();
  const transfers = useFileTransfers();
  const transferRef = useRef(transfers);
  transferRef.current = transfers;
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
  const refreshAfterMutation = useCallback(async (parentId: string | null, mode: "append" | "refresh" = "refresh") => {
    await loadFolderContent(parentId, mode).catch(() => showToast("Change saved. Folder refresh failed; the list will retry automatically.", "warning"));
  }, [loadFolderContent, showToast]);
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
        window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
      }
    },
    [runInMutationQueue, projectId]
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
        const dup = siblings.some((s) => s?.name.toLowerCase() === name.toLowerCase());
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
      // Creation undo could trash another collaborator's subsequent edits.
      // Use the normal, explicitly confirmed Trash action instead.
      showToast(`Created ${createDialog.kind} ${createdNode.name}`, "success");
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

  // Picker and flat drag/drop uploads share collision, finalization, and retry behavior.
  const uploadFiles = useCallback(async (files: File[], parentId: string | null) => {
    if (!canEdit || !files.length) return;
    const failed: File[] = [];
    const createdNodes: ProjectNode[] = [];
    const mutationKey = `upload:${projectId}:${parentId ?? "root"}:${files.map(file => file.name).sort().join(",")}`;
    let progress: string | number | undefined;
    let transferId: string | undefined;
    try {
      const outcome = await runUniqueMutation(mutationKey, async () => {
        const collisions = await getUploadCollisionSummary(projectId, parentId, files.map(file => file.name));
        const choice = await chooseUploadCollision(collisions, true);
        if (choice === "cancel") return null;
        let eligible = selectUploadFiles(files, [...collisions.existingFiles, ...collisions.existingFolders]);
        if (choice === "keep_both") {
          const occupied = [...collisions.existingFiles, ...collisions.existingFolders];
          let names = planUploadCopyNames(files.map(file => file.name), occupied);
          // Resolve suffix collisions against persisted names, not just cached rows.
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const conflicts = await getUploadCollisionSummary(projectId, parentId, names);
            if (!conflicts.existingFiles.length && !conflicts.existingFolders.length) break;
            occupied.push(...conflicts.existingFiles, ...conflicts.existingFolders);
            names = planUploadCopyNames(files.map(file => file.name), occupied);
            if (attempt === 19) throw new Error("Too many matching names. Rename the files and try again.");
          }
          eligible = files.map((file, index) => new File([file], names[index]!, { type: file.type, lastModified: file.lastModified }));
        }
        const skipped = files.length - eligible.length;
        if (!eligible.length) return skipped;
        transferId = transferRef.current?.start(files.length === 1 ? files[0]!.name : `${files.length} files`, eligible.length);
        progress = toast.loading(`Uploading 0 of ${eligible.length} files…`);
        let completed = 0;
        // ponytail: bounded batches reuse the current presign endpoint; no separate queue service.
        for (let offset = 0; offset < eligible.length; offset += 100) {
          const plans = eligible.slice(offset, offset + 100).map(file => ({
            file, key: buildProjectFileKey(projectId, crypto.randomUUID()),
            contentType: file.type || "application/octet-stream", sizeBytes: file.size,
          }));
          const batch = await getBatchUploadUrls(plans.map(({ key, contentType, sizeBytes }) => ({ key, contentType, sizeBytes })));
          if ("error" in batch) {
            failed.push(...plans.map(plan => plan.file));
            completed += plans.length;
            if (transferId) transferRef.current?.update(transferId, { completed, failed: failed.length });
            continue;
          }
          await runWithConcurrency(plans, Math.max(1, FILES_RUNTIME_BUDGETS.saveAllConcurrency), async ({ file, key, contentType }) => {
            try {
              const url = batch.urls?.[key];
              if (!url) throw new Error("Upload URL unavailable");
              const response = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
              if (!response.ok) throw new Error(`Upload failed (${response.status})`);
              const node = await createFileNode(projectId, parentId, {
                name: file.name, s3Key: key, size: file.size, mimeType: contentType,
                uploadIntentId: batch.uploadIntentIds?.[key] ?? undefined,
              });
              createdNodes.push(node as ProjectNode);
            } catch {
              // Never delete an object after an ambiguous finalization response: it may already be committed.
              failed.push(file);
            } finally {
              completed += 1;
              if (transferId) transferRef.current?.update(transferId, { completed, failed: failed.length });
              toast.loading(`Uploading ${completed} of ${eligible.length} files…`, { id: progress });
            }
          });
        }
        return skipped;
      });
      if (outcome === null) return;
      if (createdNodes.length) {
        upsertNodes(projectId, createdNodes);
        const current = useFilesWorkspaceStore.getState().byProjectId[projectId]?.childrenByParentId[filesParentKey(parentId)] ?? [];
        setChildren(projectId, parentId, [...new Set([...current, ...createdNodes.map(node => node.id)])]);
        if (parentId) toggleExpanded(projectId, parentId, true);
        await loadFolderContent(parentId, "refresh").catch(() => showToast("Files uploaded. Folder refresh failed; the list will retry automatically.", "warning"));
        window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
      }
      if (progress !== undefined) toast.dismiss(progress);
      if (transferId) transferRef.current?.update(transferId, { status: failed.length ? "error" : "done", retry: failed.length ? () => void uploadFiles(failed, parentId) : undefined, error: failed.length ? failed.map(file => file.name).join(", ") : undefined });
      if (failed.length) {
        toast.error(`${createdNodes.length} uploaded; ${failed.length} need retry`, {
          description: failed.map(file => file.name).join(", ").slice(0, 300),
          duration: Infinity,
          action: { label: "Retry failed", onClick: () => void uploadFiles(failed, parentId) },
        });
      } else {
        showToast(`${createdNodes.length} file(s) uploaded${outcome ? `; ${outcome} existing or duplicate files skipped` : ""}`, createdNodes.length ? "success" : "info");
      }
      recordOperation({ label: `Uploaded ${createdNodes.length} file(s), ${failed.length} need retry`, status: failed.length ? "error" : "success" });
      if (files.length === 1 && createdNodes.length === 1) onOpenFile(createdNodes[0]!);
    } catch (error) {
      if (progress !== undefined) toast.dismiss(progress);
      if (transferId) transferRef.current?.update(transferId, { status: "error", error: getErrorMessage(error, "Upload interrupted"), retry: () => void uploadFiles(files, parentId) });
      // Retry checks collisions again, so a lost response cannot duplicate a committed file.
      toast.error(`Upload interrupted: ${getErrorMessage(error, "Please retry")}`, {
        duration: Infinity, action: { label: "Retry", onClick: () => void uploadFiles(files, parentId) },
      });
    } finally {
      if (progress !== undefined) toast.dismiss(progress);
    }
  }, [canEdit, projectId, runUniqueMutation, upsertNodes, setChildren, toggleExpanded, loadFolderContent, showToast, recordOperation, onOpenFile, chooseUploadCollision]);

  const openUpload = useCallback((parentId: string | null) => {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => { void uploadFiles(Array.from(input.files || []), parentId); };
    input.click();
  }, [canEdit, uploadFiles]);


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
      .some((s) => s?.id !== node.id && s?.name.toLowerCase() === nextName.toLowerCase());
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
      recordOperation({
        label: `Renamed ${renameState.original} -> ${nextName}`,
        status: "success",
        undo: {
          label: "Undo",
          run: async () => {
            const reverted = (await renameNode(node.id, renameState.original, projectId, new Date(updated.updatedAt).toISOString())) as ProjectNode;
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
      if (!canManageFiles) return;
      const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
      setMoveDialog({ open: true, nodes, targetFolderId: null });
    },
    [canManageFiles]
  );

  const confirmMove = useCallback(async () => {
    const nodes = moveDialog.nodes;
    if (!nodes.length || !canManageFiles) return;

    const target = moveDialog.targetFolderId;

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

        const moveResult = await moveProjectNodes(nodeIds, target, projectId);
        const updatedNodes = moveResult.nodes;
        if (updatedNodes.length > 0) upsertNodes(projectId, updatedNodes);

        await Promise.all(Array.from(staleParents).map((pid) => refreshAfterMutation(pid, "refresh")));
        await refreshAfterMutation(target ?? null, "refresh");
        if (target) toggleExpanded(projectId, target, true);
        return updatedNodes;
      });

      if (result === null) return;
      const movedCount = result.length;
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
                  await moveProjectNodes(ids, parentId, projectId, {
                    expectedParentByNode: Object.fromEntries(ids.map((id) => [id, target])),
                  });
                  await refreshAfterMutation(parentId, "refresh");
                }
              }
              if (target !== null) await refreshAfterMutation(target, "refresh");
              else await refreshAfterMutation(null, "refresh");
            },
          }
          : undefined,
      });
      setMoveDialog({ open: false, nodes: [], targetFolderId: null });
    } catch (e: unknown) {
      showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({ label: "Move failed", status: "error" });
      throw e;
    }
  }, [canManageFiles, refreshAfterMutation, moveDialog, projectId, recordOperation, runUniqueMutation, showToast, toggleExpanded, upsertNodes]);

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

        await Promise.all(Array.from(staleParents).map((pid) => refreshAfterMutation(pid, "refresh")));
        return response;
      });

      if (result === null) return;
      recordOperation({
        label: `Moved ${result.trashedIds.length} item${result.trashedIds.length === 1 ? "" : "s"} to trash`,
        status: "success",
        undo: result.selectedTrashedIds.length
          ? {
            label: "Undo",
            run: async () => {
              await bulkRestoreNodes(result.selectedTrashedIds, projectId, result.deletedAt);
              const staleParents = new Set<string | null>();
              for (const node of nodes) staleParents.add(node.parentId ?? null);
              await Promise.all(
                Array.from(staleParents).map((pid) => refreshAfterMutation(pid, "refresh"))
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
  }, [canEdit, deleteDialog.nodes, refreshAfterMutation, onNodeDeleted, projectId, recordOperation, runUniqueMutation, showToast]);

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
      if (!files.some(file => file.webkitRelativePath?.includes("/"))) return uploadFiles(files, parentId);

      const mutationKey = `upload-direct:${projectId}:${parentId ?? "root"}:${files
        .map((f) => f.name)
        .sort()
        .join(",")}`;
      let transferId: string | undefined;
      const mappedFiles: { path: string; fileId: string; s3Key: string; name: string }[] = [];
      const succeeded = new Set<string>();
      try {
        await runUniqueMutation(mutationKey, async () => {
          const payloadNodes = files
            .map((f) => ({
              path: f.webkitRelativePath || f.name,
              name: f.name,
              size: f.size,
              mimeType: f.type || "application/octet-stream"
            }))
            .filter((node) => {
              if (node.name === ".DS_Store" || node.path.includes("__MACOSX") || node.path.includes("/.git/")) return false;
              return true;
            });

          if (payloadNodes.length === 0) return;

          const collisions = await getUploadCollisionSummary(
            projectId,
            parentId,
            payloadNodes.map((node) => node.path),
          );
          if (await chooseUploadCollision(collisions) === "cancel") {
            showToast("Upload cancelled", "info");
            return;
          }
          const existingFiles = new Set(collisions.existingFiles);
          const uploadPayloadNodes = payloadNodes.filter(
            (node) => !existingFiles.has(node.path),
          );
          if (uploadPayloadNodes.length === 0) {
            showToast("All selected files already exist and were skipped", "info");
            return;
          }

          transferId = transferRef.current?.start(`Folder upload · ${uploadPayloadNodes.length} files`, uploadPayloadNodes.length);
          const CHUNK_SIZE = 2000;
          for (let i = 0; i < uploadPayloadNodes.length; i += CHUNK_SIZE) {
            const chunk = uploadPayloadNodes.slice(i, i + CHUNK_SIZE);
            const mappedChunk = await bulkCreateFolderTree(projectId, parentId, chunk);
            if (mappedChunk) {
              mappedFiles.push(...mappedChunk);
            }
          }
          if (mappedFiles.length === 0) {
            if (transferId) transferRef.current?.update(transferId, { status: "done", total: 0, completed: 0 });
            showToast("No new files to upload; existing files were kept", "info");
            return;
          }

          const mappingByPath = new Map(mappedFiles.map((entry) => [entry.path, entry]));
          const uploadNodes = files
            .map((file) => {
              const mapping = mappingByPath.get(file.webkitRelativePath || file.name);
              if (!mapping) return null;
              return { file, s3Key: mapping.s3Key, fileId: mapping.fileId, path: mapping.path };
            })
            .filter((item): item is { file: File; s3Key: string; fileId: string; path: string } => item !== null);

          if (uploadNodes.length === 0) throw new Error("Could not match the selected files to their upload destinations");
          if (transferId) transferRef.current?.update(transferId, { total: uploadNodes.length });

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
              throw new Error(batch.error || "Failed to prepare upload URLs");
            }
            Object.assign(presignedUploadUrls, batch.urls || {});
          }

          const performCleanup = async (w?: Worker) => {
            if (w) w.terminate();
            if (mappedFiles.length > 0) {
              const fileIds = mappedFiles.filter(m => !succeeded.has(m.fileId)).map((m) => m.fileId);
              if (!fileIds.length) return;
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

          showToast(`Uploading ${uploadNodes.length} file(s) in background...`, "info");
          const retryFiles = () => files.filter(file => {
            const mapping = mappingByPath.get(file.webkitRelativePath || file.name);
            return mapping && !succeeded.has(mapping.fileId);
          });
          let finish!: () => void;
          const finished = new Promise<void>(resolve => { finish = resolve; });
          const reportFailure = (error: string) => {
            const failed = retryFiles();
            if (transferId) transferRef.current?.update(transferId, { status: "error", failed: failed.length, completed: succeeded.size, error, retry: () => void uploadFilesDirectly(failed, parentId) });
          };

          worker.postMessage({
            jobId: uploadJobId,
            uploadNodes,
            uploadUrls: presignedUploadUrls,
          });

          worker.onmessage = async (e) => {
            if (e.data?.jobId && e.data.jobId !== uploadJobId) return;
            if (e.data.type === "progress") {
              if (e.data.fileSucceeded && e.data.fileId) succeeded.add(e.data.fileId);
              if (transferId) transferRef.current?.update(transferId, { completed: e.data.completed, failed: e.data.failed });
            }

            if (e.data.type === "error") {
              await performCleanup(worker);
              showToast(`Upload failed: ${e.data.message || "Unexpected worker error"}`, "error");
              recordOperation({ label: "Upload failed (worker error)", status: "error" });
              reportFailure(e.data.message || "Upload worker failed");
              finish();
              return;
            }

            if (e.data.type === "done") {
              worker.terminate();
              for (const result of e.data.results ?? []) if (result.success && result.fileId) succeeded.add(result.fileId);
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
                reportFailure("Some files could not be uploaded. Successful files have been kept.");
                showToast(`Uploaded with ${e.data.failed} errors.`, "warning");
                recordOperation({ label: `Partial upload: ${e.data.failed} failed`, status: "error" });
              } else {
                if (transferId) transferRef.current?.update(transferId, { status: "done", completed: uploadNodes.length, failed: 0 });
                showToast(`Successfully uploaded ${e.data.success} file(s).`, "success");
                recordOperation({ label: `Uploaded ${e.data.success} file(s)`, status: "success" });
              }

              loadFolderContent(parentId, "refresh").then(() => {
                if (parentId) toggleExpanded(projectId, parentId, true);
              }).catch(() => showToast("Files uploaded. Refresh failed; the list will retry automatically.", "warning"));
              window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
              finish();
            }
          };

          worker.onerror = async () => {
            await performCleanup(worker);
            reportFailure("Upload worker stopped. Retry the unfinished files.");
            finish();
            showToast("Fatal upload worker process error", "error");
            recordOperation({ label: "Upload failed (worker crash)", status: "error" });
          };
          await finished;
        });
      } catch (e: unknown) {
        const incomplete = mappedFiles.filter(file => !succeeded.has(file.fileId));
        if (incomplete.length) await bulkTrashNodes(incomplete.map(file => file.fileId), projectId).catch(() => null);
        if (transferId) transferRef.current?.update(transferId, { status: "error", error: getErrorMessage(e, "Upload failed"), retry: () => void uploadFilesDirectly(files, parentId) });
        showToast(`Upload failed: ${getErrorMessage(e, "Unknown error")}`, "error");
        recordOperation({ label: "Upload failed", status: "error" });
      }
    },
    [
      canEdit,
      projectId,
      runUniqueMutation,
      showToast,
      recordOperation,
      loadFolderContent,
      toggleExpanded,
      uploadFiles,
      chooseUploadCollision,
    ]
  );

  const openFolderUpload = useCallback((parentId: string | null) => {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => { void uploadFilesDirectly(Array.from(input.files || []), parentId); };
    input.click();
  }, [canEdit, uploadFilesDirectly]);

  return {
    uploadCollisionDialog,
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
