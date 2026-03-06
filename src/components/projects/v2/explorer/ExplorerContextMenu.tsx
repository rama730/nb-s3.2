"use client";

import { useCallback, useMemo } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { FileTreeItemContext } from "./FileTreeItem";
import {
  bulkRestoreNodes,
  bulkTrashNodes,
  getTrashNodes,
} from "@/app/actions/files";
import type { ExplorerOperation } from "./explorerTypes";

/**
 * Builds the FileTreeItemContext object that is passed to each tree row via
 * react-virtuoso's `context` prop. This hook encapsulates all the callback
 * wiring so ExplorerShell stays lean.
 */
export function useTreeContext(options: {
  projectId: string;
  nodesById: Record<string, ProjectNode>;
  selectedNodeId: string | null | undefined;
  effectiveSelectedNodeIds: string[];
  expandedFolderIds: Record<string, boolean>;
  favorites: Record<string, boolean>;
  taskLinkCounts: Record<string, number>;
  locksByNodeId: Record<
    string,
    { lockedBy: string; lockedByName?: string | null; expiresAt: number }
  >;
  mode: "default" | "select";
  canEdit: boolean;
  projectName: string;
  effectiveMode: string;
  // Inline rename
  renameNodeId: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  // Desktop drop upload
  onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;
  // Folder sizes
  folderSizes: Record<string, number>;
  handleSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
  handleToggleFolder: (node: ProjectNode) => Promise<void>;
  handleDropOnFolder: (targetId: string, draggedId: string) => Promise<void>;
  handleLoadMore: (pid: string | null) => void;
  openCreate: (kind: "file" | "folder") => void;
  openCreateInFolder: (folderId: string | null, kind: "file" | "folder") => void;
  handleUploadToFolder: (folderId: string | null) => void;
  handleUploadFolderToFolder: (folderId: string | null) => void;
  handleDownloadFolder: (folderId: string) => void;
  openRename: (node: ProjectNode) => void;
  handleMoveFromMenu: (node: ProjectNode) => void;
  handleDeleteFromMenu: (node: ProjectNode) => void;
  handleTaskLinksClick: (node: ProjectNode) => void;
  toggleFavorite: (projectId: string, nodeId: string) => void;
  loadFolderContent: (parentId: string | null, mode: "refresh" | "append") => Promise<void>;
  runUniqueMutation: <T>(key: string, fn: () => Promise<T>) => Promise<T | null>;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
  recordOperation: (op: Omit<ExplorerOperation, "id" | "at">) => void;
  setTrashNodesState: React.Dispatch<React.SetStateAction<ProjectNode[]>>;
  onContextMenu: (node: ProjectNode, e: React.MouseEvent) => void;
}): FileTreeItemContext {
  const {
    projectId,
    nodesById,
    selectedNodeId,
    effectiveSelectedNodeIds,
    expandedFolderIds,
    favorites,
    taskLinkCounts,
    locksByNodeId,
    mode,
    canEdit,
    projectName,
    effectiveMode,
    handleSelect,
    handleToggleFolder,
    handleDropOnFolder,
    handleLoadMore,
    openCreate,
    openCreateInFolder,
    handleUploadToFolder,
    handleUploadFolderToFolder,
    handleDownloadFolder,
    openRename,
    handleMoveFromMenu,
    handleDeleteFromMenu,
    handleTaskLinksClick,
    toggleFavorite,
    loadFolderContent,
    runUniqueMutation,
    showToast,
    recordOperation,
    setTrashNodesState,
    onContextMenu,
  } = options;

  const {
    renameNodeId,
    renameValue,
    onRenameChange,
    onRenameConfirm,
    onRenameCancel,
    onDesktopFileDrop,
    folderSizes,
  } = options;

  const handleOpenNodeFromMenu = useCallback(
    (node: ProjectNode) => {
      handleSelect(node);
      if (node.type === "folder" && !expandedFolderIds[node.id]) {
        void handleToggleFolder(node);
      }
    },
    [expandedFolderIds, handleSelect, handleToggleFolder]
  );

  const restoreNode = useCallback(
    async (id: string) => {
      const mutationKey = `restore:${projectId}:${id}`;
      const result = await runUniqueMutation(mutationKey, async () => {
        await bulkRestoreNodes([id], projectId);
        const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
        setTrashNodesState(nodes);
        const node = nodesById[id];
        if (node?.parentId) await loadFolderContent(node.parentId, "refresh");
        return true;
      });
      if (result === null) return;
      showToast("Restored", "success");
      recordOperation({
        label: "Restored item",
        status: "success",
        undo: {
          label: "Undo",
          run: async () => {
            await bulkTrashNodes([id], projectId);
            const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
            setTrashNodesState(nodes);
          },
        },
      });
    },
    [
      projectId,
      nodesById,
      runUniqueMutation,
      loadFolderContent,
      showToast,
      recordOperation,
      setTrashNodesState,
    ]
  );

  return useMemo(
    (): FileTreeItemContext => ({
      nodesById,
      selectedNodeId: selectedNodeId ?? null,
      selectedNodeIds: effectiveSelectedNodeIds,
      expandedFolderIds,
      favorites,
      taskLinkCounts,
      locksByNodeId,
      mode: mode || "default",
      canEdit,
      projectName: projectName || "Project",
      isTrashMode: effectiveMode === "trash",

      // Inline rename
      renameNodeId,
      renameValue,
      onRenameChange,
      onRenameConfirm,
      onRenameCancel,

      // Desktop drop
      onDesktopFileDrop,

      // Folder sizes
      folderSizes,

      onToggle: (node: ProjectNode) => void handleToggleFolder(node),
      onSelect: (node: ProjectNode, e?: React.MouseEvent) => handleSelect(node, e),
      onContextMenu,
      onDragStart: () => {},
      onDragEnd: () => {},
      onDrop: (targetId: string, draggedId: string) =>
        void handleDropOnFolder(targetId, draggedId),
      onLoadMore: (pid: string | null) => handleLoadMore(pid),
      openCreate: (kind: "file" | "folder") => openCreate(kind),
      createInFolder: (folderId: string | null, kind: "file" | "folder") =>
        openCreateInFolder(folderId, kind),
      uploadToFolder: (folderId: string | null) => handleUploadToFolder(folderId),
      uploadFolderToFolder: (folderId: string | null) => handleUploadFolderToFolder(folderId),
      downloadFolder: (folderId: string) => handleDownloadFolder(folderId),
      openNode: (node: ProjectNode) => handleOpenNodeFromMenu(node),
      renameNode: (node: ProjectNode) => openRename(node),
      moveNode: (node: ProjectNode) => handleMoveFromMenu(node),
      deleteNode: (node: ProjectNode) => handleDeleteFromMenu(node),
      toggleFavorite: (nodeId: string) => toggleFavorite(projectId, nodeId),
      onTaskLinksClick: (node: ProjectNode) => handleTaskLinksClick(node),
      restoreNode,
    }),
    [
      nodesById,
      selectedNodeId,
      effectiveSelectedNodeIds,
      expandedFolderIds,
      favorites,
      taskLinkCounts,
      locksByNodeId,
      mode,
      canEdit,
      projectName,
      effectiveMode,
      projectId,
      renameNodeId,
      renameValue,
      onRenameChange,
      onRenameConfirm,
      onRenameCancel,
      onDesktopFileDrop,
      folderSizes,
      handleSelect,
      handleToggleFolder,
      handleDropOnFolder,
      handleLoadMore,
      onContextMenu,
      openCreate,
      openCreateInFolder,
      handleUploadToFolder,
      handleUploadFolderToFolder,
      handleDownloadFolder,
      handleOpenNodeFromMenu,
      openRename,
      handleMoveFromMenu,
      handleDeleteFromMenu,
      handleTaskLinksClick,
      toggleFavorite,
      restoreNode,
    ]
  );
}
