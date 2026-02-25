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
} from "@/app/actions/files";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";

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
        const storagePath = `projects/${projectId}/${Math.random().toString(36).substring(2)}.${fileExt}`;
        const supabase = getSupabase();
        const emptyBlob = new Blob([""], { type: "text/plain" });
        const { error: uploadError } = await supabase.storage.from("project-files").upload(storagePath, emptyBlob);
        if (uploadError) throw uploadError;

        return (await createFileNode(projectId, parentId, {
          name,
          s3Key: storagePath,
          size: 0,
          mimeType: "text/plain",
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
    getSupabase,
    loadedChildren,
    loadFolderContent,
    nodesById,
    projectId,
    recordOperation,
    runUniqueMutation,
    setChildren,
    showToast,
    toggleExpanded,
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

            for (const file of files) {
              try {
                const ext = file.name.split(".").pop() || "bin";
                const fileName = `${Math.random().toString(36).slice(2)}.${ext}`;
                const filePath = `projects/${projectId}/${fileName}`;
                const { error } = await supabase.storage.from("project-files").upload(filePath, file);
                if (error) throw error;

                const node = (await createFileNode(projectId, parentId, {
                  name: file.name,
                  s3Key: filePath,
                  size: file.size,
                  mimeType: file.type,
                })) as ProjectNode;
                createdNodes.push(node);
              } catch {
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
    runUniqueMutation,
  };
}
