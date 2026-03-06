"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import {
  getNodeActivity,
  getNodeLinkedTasks,
} from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import OutlinePanel from "./OutlinePanel";
import SourceControlPanel from "./SourceControlPanel";
import MultiFileDiffDialog from "./MultiFileDiffDialog";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  FolderOpen,
  StarOff,
  Star,
  FilePlus2,
  FolderPlus,
  Upload,
  FolderInput,
  Download,
  Pencil,
  Trash2,
  RotateCcw,
  Check,
  ArrowRightLeft,
} from "lucide-react";

import {
  type ExplorerProps,
  EMPTY_OBJECT,
  EMPTY_ARRAY,
  areIdListsEqual,
} from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";
import { useExplorerBoot } from "./useExplorerBoot";
import { useExplorerDragDrop } from "./useExplorerDragDrop";
import { useVisibleRows, useRowsToRender, ExplorerTree } from "./ExplorerTree";
import { useExplorerSearch } from "./ExplorerSearch";
import { useTreeContext } from "./ExplorerContextMenu";
import { ExplorerToolbarHost } from "./ExplorerToolbarHost";
import { ExplorerOperationsHost } from "./ExplorerOperationsHost";
import { ExplorerInsightsHost } from "./ExplorerInsightsHost";
import { ExplorerDialogsHost } from "./ExplorerDialogsHost";
import { MultiSelectActionsBar } from "./MultiSelectActionsBar";
import { useExplorerOperationLog } from "./useExplorerOperationLog";
import { useExplorerMutations } from "./useExplorerMutations";

export default function ExplorerShell({
  projectId,
  projectName,
  canEdit,
  viewMode = "code",
  onOpenFile,
  onNodeDeleted,
  mode = "default",
  selectedNodeIds = [],
  onSelectionChange,
  syncStatus,
}: ExplorerProps) {
  const { showToast } = useToast();

  // --- Store selectors (granular for performance) ---
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJECT
  );
  const childrenByParentId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJECT
  );
  const loadedChildren = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJECT
  );
  const expandedFolderIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJECT
  );
  const folderMeta = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.folderMeta || EMPTY_OBJECT
  );
  const treeVersion = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.treeVersion || 0
  );
  const explorerMode = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.explorerMode || "tree"
  );
  const searchQuery = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.searchQuery || ""
  );
  const favorites = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.favorites || EMPTY_OBJECT
  );
  const recents = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.recents || EMPTY_ARRAY
  );
  const savedViews = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.savedViews || EMPTY_ARRAY
  );
  const sort = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.sort || "name"
  );
  const foldersFirst = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.foldersFirst ?? true
  );
  const selectedNodeId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedNodeId
  );
  const storeSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedNodeIds || EMPTY_ARRAY
  );
  const selectedFolderId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedFolderId
  );
  const taskLinkCounts = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT
  );
  const locksByNodeId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.locksByNodeId || EMPTY_OBJECT
  );

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesWorkspaceStore((s) => s.setSelectedNodeIds);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const setSearchQuery = useFilesWorkspaceStore((s) => s.setSearchQuery);
  const setSort = useFilesWorkspaceStore((s) => s.setSort);
  const addRecent = useFilesWorkspaceStore((s) => s.addRecent);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);
  const saveCurrentView = useFilesWorkspaceStore((s) => s.saveCurrentView);
  const applySavedView = useFilesWorkspaceStore((s) => s.applySavedView);
  const deleteSavedView = useFilesWorkspaceStore((s) => s.deleteSavedView);
  const setExplorerMode = useFilesWorkspaceStore((s) => s.setExplorerMode);
  const setViewMode = useFilesWorkspaceStore((s) => s.setViewMode);

  // --- Derived state ---
  const isSelectionMode = mode === "select";
  const controlledSelectedNodeIds = useMemo(
    () => Array.from(new Set(selectedNodeIds)),
    [selectedNodeIds]
  );
  const effectiveSelectedNodeIds = isSelectionMode
    ? controlledSelectedNodeIds
    : storeSelectedNodeIds;
  const uploadEnabled = !isSelectionMode;

  useEffect(() => {
    if (!isSelectionMode) return;
    const currentSelected =
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
    if (areIdListsEqual(currentSelected, controlledSelectedNodeIds)) return;
    setSelectedNodeIds(projectId, controlledSelectedNodeIds);
  }, [isSelectionMode, projectId, controlledSelectedNodeIds, setSelectedNodeIds]);

  // --- Dialog state ---
  const [quickOpen, setQuickOpen] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const [commandPalette, setCommandPalette] = useState<{
    open: boolean;
    query: string;
  }>({ open: false, query: "" });
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string>("");
  const {
    operationsOpen,
    setOperationsOpen,
    operations,
    recordOperation,
    executeUndo,
    clearOperations,
  } = useExplorerOperationLog();
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [linkedTasks, setLinkedTasks] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      taskNumber: number | null;
      dueDate: number | null;
      linkedAt: number;
    }>
  >([]);
  const [nodeActivity, setNodeActivity] = useState<
    Array<{
      id: string;
      type: string;
      at: number;
      by: string | null;
      metadata: Record<string, unknown> | null;
    }>
  >([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // --- Comparison state (Phase 2e) ---
  const [compareSourceId, setCompareSourceId] = useState<string | null>(null);
  const [compareDialog, setCompareDialog] = useState({
    open: false,
    baseNode: null as ProjectNode | null,
    compareNode: null as ProjectNode | null,
  });
  // --- Refs ---
  const containerRef = useRef<HTMLDivElement | null>(null);

  // --- Boot / data fetching ---
  const { isBooting, accessError, loadFolderContent, handleToggleFolder, handleLoadMore } =
    useExplorerBoot({ projectId, canEdit, syncStatus, showToast });

  // --- Visible rows ---
  const { visibleRows, includeFileByMode } = useVisibleRows({
    projectId,
    treeVersion,
    explorerMode,
    nodesById: nodesById as Record<string, ProjectNode>,
    childrenByParentId: childrenByParentId as Record<string, string[]>,
    loadedChildren: loadedChildren as Record<string, boolean>,
    expandedFolderIds: expandedFolderIds as Record<string, boolean>,
    folderMeta: folderMeta as Record<
      string,
      { nextCursor: string | null; hasMore: boolean }
    >,
    sort: sort as "name" | "updated" | "type",
    foldersFirst: foldersFirst as boolean,
    viewMode,
  });

  // --- Search ---
  const {
    searchResults,
    isSearching,
    trashNodesState,
    setTrashNodesState,
    isTrashLoading,
    inlineSearchOpen,
    setInlineSearchOpen,
  } = useExplorerSearch({ projectId, searchQuery, explorerMode });

  const effectiveMode = searchQuery.trim() ? "search" : explorerMode;

  const rowsToRender = useRowsToRender({
    effectiveMode,
    visibleRows,
    searchResults,
    trashNodesState,
    favorites: favorites as Record<string, boolean>,
    recents: recents as string[],
    nodesById: nodesById as Record<string, ProjectNode>,
    includeFileByMode,
  });

  const selectedNode = selectedNodeId
    ? (nodesById as Record<string, ProjectNode>)[selectedNodeId] ?? null
    : null;

  // --- Insights ---
  const loadNodeInsights = useCallback(
    async (nodeId: string) => {
      setInsightsLoading(true);
      setInsightsError(null);
      try {
        const [tasksData, activityData] = await Promise.all([
          getNodeLinkedTasks(projectId, nodeId, 30),
          getNodeActivity(projectId, nodeId, 30),
        ]);
        setLinkedTasks(tasksData);
        setNodeActivity(activityData);
      } catch (error: unknown) {
        setLinkedTasks([]);
        setNodeActivity([]);
        setInsightsError(getErrorMessage(error, "Failed to load node insights"));
      } finally {
        setInsightsLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!isInsightsOpen || !selectedNodeId) {
      if (!selectedNodeId) {
        setLinkedTasks([]);
        setNodeActivity([]);
        setInsightsError(null);
      }
      return;
    }
    void loadNodeInsights(selectedNodeId);
  }, [selectedNodeId, isInsightsOpen, loadNodeInsights]);

  const handleTaskLinksClick = useCallback(
    (node: ProjectNode) => {
      setSelectedNode(
        projectId,
        node.id,
        node.type === "folder" ? node.id : node.parentId ?? null
      );
      setSelectedNodeIds(projectId, [node.id]);
      setIsInsightsOpen(true);
      void loadNodeInsights(node.id);
    },
    [loadNodeInsights, projectId, setSelectedNode, setSelectedNodeIds]
  );

  // --- Create / Upload / Rename handlers ---
  const {
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
  } = useExplorerMutations({
    projectId,
    canEdit,
    selectedNode,
    selectedFolderId,
    nodesById: nodesById as Record<string, ProjectNode>,
    childrenByParentId: childrenByParentId as Record<string, string[]>,
    loadedChildren: loadedChildren as Record<string, boolean>,
    storeSelectedNodeIds: storeSelectedNodeIds as string[],
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
  });

  // --- Selection ---
  const handleSelect = useCallback(
    (node: ProjectNode, e?: React.MouseEvent) => {
      if (mode === "select") {
        const currentSelected =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds ||
          controlledSelectedNodeIds;
        const exists = currentSelected.includes(node.id);
        const newSelection = exists
          ? currentSelected.filter((id) => id !== node.id)
          : [...currentSelected, node.id];
        const normalizedSelection = Array.from(new Set(newSelection));
        setSelectedNodeIds(projectId, normalizedSelection);
        onSelectionChange?.(normalizedSelection);
        return;
      }

      if (e && (e.metaKey || e.ctrlKey)) {
        const currentSelected =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds ||
          [];
        const alreadySelected = currentSelected.includes(node.id);
        let newSelection: string[];
        if (alreadySelected) {
          newSelection = currentSelected.filter((id) => id !== node.id);
        } else {
          newSelection = [...currentSelected, node.id];
        }
        setSelectedNodeIds(projectId, newSelection);

        if (!alreadySelected) {
          setSelectedNode(
            projectId,
            node.id,
            node.type === "folder" ? node.id : node.parentId ?? null
          );
        }
        return;
      }

      if (e && e.shiftKey && selectedNodeId) {
        if (rowsToRender.length === 0) return;
        const anchorId = selectedNodeId;
        const targetId = node.id;
        const anchorIndex = rowsToRender.findIndex(
          (r) => r.kind === "node" && r.nodeId === anchorId
        );
        const targetIndex = rowsToRender.findIndex(
          (r) => r.kind === "node" && r.nodeId === targetId
        );
        if (anchorIndex !== -1 && targetIndex !== -1) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const rangeIds: string[] = [];
          for (let i = start; i <= end; i++) {
            const row = rowsToRender[i];
            if (row.kind === "node") {
              rangeIds.push(row.nodeId);
            }
          }
          setSelectedNodeIds(projectId, rangeIds);
          return;
        }
      }

      setSelectedNodeIds(projectId, [node.id]);
      setSelectedNode(
        projectId,
        node.id,
        node.type === "folder" ? node.id : node.parentId ?? null
      );

      // Phase 5: Shallow URL VFS Routing
      const fullPath = getNodePath(node);
      if (fullPath) {
        const url = new URL(window.location.href);
        url.searchParams.set("path", fullPath);
        window.history.replaceState({}, "", url.toString());
      }

      if (node.type === "file") {
        addRecent(projectId, node.id);
        onOpenFile(node);
      }
    },
    [
      projectId,
      rowsToRender,
      mode,
      selectedNodeId,
      setSelectedNode,
      setSelectedNodeIds,
      addRecent,
      onOpenFile,
      controlledSelectedNodeIds,
      onSelectionChange,
    ]
  );

  // --- Drag & Drop ---
  const { handleDropOnFolder } = useExplorerDragDrop({
    projectId,
    canEdit,
    nodesById: nodesById as Record<string, ProjectNode>,
    storeSelectedNodeIds: storeSelectedNodeIds as string[],
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast,
    recordOperation,
  });

  // --- Context Menu State ---
  const [contextMenuState, setContextMenuState] = useState<{
    open: boolean;
    x: number;
    y: number;
    node: ProjectNode | null;
  }>({ open: false, x: 0, y: 0, node: null });

  const handleContextMenu = useCallback((node: ProjectNode, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuState({ open: true, x: e.clientX, y: e.clientY, node });
  }, []);

  // --- Inline rename callbacks for tree context ---
  const handleRenameChange = useCallback((v: string) => {
    setRenameState((prev) => ({ ...prev, value: v }));
  }, [setRenameState]);

  const handleInlineRenameConfirm = useCallback(() => {
    if (!renameState.nodeId) return;
    void confirmRename();
  }, [renameState.nodeId, confirmRename]);

  const handleInlineRenameCancel = useCallback(() => {
    setRenameState({ nodeId: null, value: "", original: "" });
  }, [setRenameState]);

  // --- Desktop file drop handler (uses uploadFilesDirectly, NOT the picker) ---
  const handleDesktopFileDrop = useCallback(
    (files: File[], targetFolderId: string) => {
      if (!canEdit || !files.length) return;
      void uploadFilesDirectly(files, targetFolderId);
    },
    [canEdit, uploadFilesDirectly]
  );

  // --- Folder sizes (computed from nodesById) ---
  const folderSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    const nodes = nodesById as Record<string, ProjectNode>;
    for (const id in nodes) {
      const node = nodes[id];
      if (node.type !== "file" || !node.parentId || !node.size) continue;
      let cursor: string | null = node.parentId;
      let guard = 0;
      while (cursor && guard < 50) {
        sizes[cursor] = (sizes[cursor] || 0) + (node.size || 0);
        const parentNode: ProjectNode | undefined = nodes[cursor];
        cursor = parentNode?.parentId ?? null;
        guard++;
      }
    }
    return sizes;
  }, [nodesById]);

  // --- Tree context ---
  const contextValue = useTreeContext({
    projectId,
    nodesById: nodesById as Record<string, ProjectNode>,
    selectedNodeId,
    effectiveSelectedNodeIds,
    expandedFolderIds: expandedFolderIds as Record<string, boolean>,
    favorites: favorites as Record<string, boolean>,
    taskLinkCounts: taskLinkCounts as Record<string, number>,
    locksByNodeId: locksByNodeId as Record<
      string,
      { lockedBy: string; lockedByName?: string | null; expiresAt: number }
    >,
    mode: mode as "default" | "select",
    canEdit,
    projectName: projectName || "Project",
    effectiveMode,
    // Inline rename
    renameNodeId: renameState.nodeId,
    renameValue: renameState.value,
    onRenameChange: handleRenameChange,
    onRenameConfirm: handleInlineRenameConfirm,
    onRenameCancel: handleInlineRenameCancel,
    // Desktop drop
    onDesktopFileDrop: handleDesktopFileDrop,
    // Folder sizes
    folderSizes,
    handleSelect,
    handleToggleFolder,
    handleDropOnFolder,
    handleLoadMore,
    openCreate,
    openCreateInFolder,
    handleUploadToFolder,
    handleUploadFolderToFolder: openFolderUpload,
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
    onContextMenu: handleContextMenu,
  });

  // --- Keyboard navigation ---
  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rowsToRender.forEach((r, idx) => {
      if (r.kind === "node") map.set(r.nodeId, idx);
    });
    return map;
  }, [rowsToRender]);

  const selectedIndex = selectedNodeId ? rowIndexById.get(selectedNodeId) : undefined;

  const getNodePath = useCallback(
    (node: ProjectNode | null | undefined) => {
      if (!node) return "";
      const parts: string[] = [node.name];
      let cursor = node.parentId;
      let guard = 0;
      while (cursor && guard < 256) {
        const parent = (nodesById as Record<string, ProjectNode>)[cursor];
        if (!parent) break;
        parts.unshift(parent.name);
        cursor = parent.parentId;
        guard += 1;
      }
      return parts.join("/");
    },
    [nodesById]
  );

  const focusRow = (index: number) => {
    const row = rowsToRender[index];
    if (row?.kind === "node") {
      const node = (nodesById as Record<string, ProjectNode>)[row.nodeId];
      if (node) handleSelect(node);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    if (renameState.nodeId) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setQuickOpen({ open: true, query: "" });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setCommandPalette({ open: true, query: "" });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "n") {
      if (!canEdit) return;
      e.preventDefault();
      openCreate("file");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "f") {
      if (!canEdit) return;
      e.preventDefault();
      openCreate("folder");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
      if (!canEdit) return;
      e.preventDefault();
      if (storeSelectedNodeIds.length > 0) {
        const nodes = (storeSelectedNodeIds as string[])
          .map((id) => (nodesById as Record<string, ProjectNode>)[id])
          .filter(Boolean);
        openMove(nodes);
      } else if (selectedNode) {
        openMove(selectedNode);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next =
        selectedIndex === undefined
          ? 0
          : Math.min(rowsToRender.length - 1, selectedIndex + 1);
      focusRow(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev =
        selectedIndex === undefined ? 0 : Math.max(0, selectedIndex - 1);
      focusRow(prev);
    } else if (e.key === "ArrowRight") {
      if (!selectedNode) return;
      if (selectedNode.type === "folder") {
        e.preventDefault();
        if (!(expandedFolderIds as Record<string, boolean>)[selectedNode.id])
          await handleToggleFolder(selectedNode);
      }
    } else if (e.key === "ArrowLeft") {
      if (!selectedNode) return;
      if (
        selectedNode.type === "folder" &&
        (expandedFolderIds as Record<string, boolean>)[selectedNode.id]
      ) {
        e.preventDefault();
        toggleExpanded(projectId, selectedNode.id, false);
      } else if (selectedNode.parentId) {
        const parent = (nodesById as Record<string, ProjectNode>)[
          selectedNode.parentId
        ];
        if (parent) {
          e.preventDefault();
          handleSelect(parent);
        }
      }
    } else if (e.key === "Enter") {
      if (!selectedNode) return;
      e.preventDefault();
      if (selectedNode.type === "folder") await handleToggleFolder(selectedNode);
      else handleSelect(selectedNode);
    } else if (e.key === " ") {
      if (!selectedNode || selectedNode.type !== "folder") return;
      e.preventDefault();
      await handleToggleFolder(selectedNode);
    } else if (e.key === "F2") {
      if (!selectedNode) return;
      e.preventDefault();
      openRename(selectedNode);
    } else if (e.key === "Escape") {
      if (renameState.nodeId) {
        e.preventDefault();
        setRenameState({ nodeId: null, value: "", original: "" });
      }
    } else if (e.key === "Delete") {
      if (!canEdit) return;
      e.preventDefault();
      if (storeSelectedNodeIds.length > 0) {
        const nodes = (storeSelectedNodeIds as string[])
          .map((id) => (nodesById as Record<string, ProjectNode>)[id])
          .filter(Boolean);
        openDelete(nodes);
      } else if (selectedNode) {
        openDelete(selectedNode);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      if (!selectedNode) return;
      e.preventDefault();
      const path = getNodePath(selectedNode);
      if (!path) return;
      try {
        await navigator.clipboard.writeText(path);
        showToast("Path copied", "success");
      } catch {
        showToast("Failed to copy path", "error");
      }
    }
  };

  // --- Saved views ---
  const handleSaveCurrentView = useCallback(() => {
    const defaultName = `View ${new Date().toLocaleDateString()}`;
    const name = window.prompt("Save current view as:", defaultName);
    if (!name) return;
    saveCurrentView(projectId, name);
    const latestViews =
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.savedViews || [];
    const saved = latestViews.find(
      (view) => view.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (saved) setSelectedSavedViewId(saved.id);
    showToast("View saved", "success");
  }, [projectId, saveCurrentView, showToast]);

  const handleApplySavedView = useCallback(
    (viewId: string) => {
      if (!viewId) return;
      applySavedView(projectId, viewId);
      setSelectedSavedViewId(viewId);
      showToast("View applied", "success");
    },
    [applySavedView, projectId, showToast]
  );

  const handleDeleteSavedView = useCallback(() => {
    if (!selectedSavedViewId) return;
    deleteSavedView(projectId, selectedSavedViewId);
    setSelectedSavedViewId("");
    showToast("View removed", "success");
  }, [deleteSavedView, projectId, selectedSavedViewId, showToast]);

  // =================== RENDER ===================
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="tree"
      aria-label="File explorer"
      onKeyDown={handleKeyDown}
      className="h-full flex flex-col bg-white dark:bg-zinc-900 outline-none"
    >
      <ExplorerToolbarHost
        canEdit={canEdit}
        viewMode={viewMode}
        explorerMode={explorerMode}
        searchQuery={searchQuery}
        inlineSearchOpen={inlineSearchOpen}
        isSearching={isSearching}
        operationsOpen={operationsOpen}
        isInsightsOpen={isInsightsOpen}
        uploadEnabled={uploadEnabled}
        selectedNode={selectedNode}
        selectedFolderId={selectedFolderId}
        savedViews={savedViews as Array<{ id: string; name: string }>}
        selectedSavedViewId={selectedSavedViewId}
        onSetViewMode={(mode) => setViewMode(projectId, mode)}
        onSetExplorerMode={(mode) => setExplorerMode(projectId, mode)}
        onToggleInlineSearch={() =>
          setInlineSearchOpen((prev) => {
            const next = !prev;
            if (!next) setSearchQuery(projectId, "");
            return next;
          })
        }
        onSearchQueryChange={(value) => setSearchQuery(projectId, value)}
        onSortChange={(value) => setSort(projectId, value)}
        sort={sort as "name" | "updated" | "type"}
        onToggleOperationsOpen={() => setOperationsOpen((open) => !open)}
        onToggleInsightsOpen={() => setIsInsightsOpen((open) => !open)}
        onSaveCurrentView={handleSaveCurrentView}
        onApplySavedView={handleApplySavedView}
        onDeleteSavedView={handleDeleteSavedView}
        onOpenCreateFolder={() => openCreate("folder")}
        onOpenCreateFile={() => openCreate("file")}
        onUpload={openUpload}
        onUploadFolder={openFolderUpload}
      />

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {explorerMode === "sourceControl" ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <SourceControlPanel projectId={projectId} className="px-2" />
          </div>
        ) : explorerMode === "outline" ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <OutlinePanel projectId={projectId} className="px-2" />
          </div>
        ) : (
          <ExplorerTree
            rowsToRender={rowsToRender}
            contextValue={contextValue}
            nodesById={nodesById as Record<string, ProjectNode>}
            childrenByParentId={childrenByParentId}
            effectiveSelectedNodeIds={effectiveSelectedNodeIds as string[]}
            selectedNodeId={selectedNodeId}
            viewMode={viewMode}
            effectiveMode={effectiveMode}
            isBooting={isBooting}
            isTrashLoading={isTrashLoading}
            accessError={accessError}
            onSelect={handleSelect}
            onToggleFolder={handleToggleFolder}
            onDropOnFolder={handleDropOnFolder}
            onDownloadFolder={handleDownloadFolder}
          />
        )}
      </div>

      {/* Multi-Select Actions Bar */}
      <MultiSelectActionsBar
        count={effectiveSelectedNodeIds.length}
        canEdit={canEdit}
        onMove={() => {
          const nodes = effectiveSelectedNodeIds
            .map((id) => (nodesById as Record<string, ProjectNode>)[id])
            .filter(Boolean);
          if (nodes.length > 0) openMove(nodes);
        }}
        onDelete={() => {
          const nodes = effectiveSelectedNodeIds
            .map((id) => (nodesById as Record<string, ProjectNode>)[id])
            .filter(Boolean);
          if (nodes.length > 0) openDelete(nodes);
        }}
        onCopyPaths={async () => {
          const paths = effectiveSelectedNodeIds
            .map((id) => {
              const node = (nodesById as Record<string, ProjectNode>)[id];
              return node ? getNodePath(node) : null;
            })
            .filter(Boolean)
            .join("\n");
          try {
            await navigator.clipboard.writeText(paths);
            showToast(`Copied ${effectiveSelectedNodeIds.length} paths`, "success");
          } catch {
            showToast("Failed to copy paths", "error");
          }
        }}
        onClear={() => setSelectedNodeIds(projectId, [])}
      />

      {/* Phase 5: Centralized Portal Context Menu */}
      <DropdownMenu
        open={contextMenuState.open}
        onOpenChange={(open) => setContextMenuState((prev) => ({ ...prev, open }))}
      >
        <div
          style={{
            position: "fixed",
            left: contextMenuState.x,
            top: contextMenuState.y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
        <DropdownMenuContent
          align="start"
          className="w-48 absolute z-50"
          style={{ left: contextMenuState.x, top: contextMenuState.y }}
        >
          {contextMenuState.node && explorerMode === "trash" ? (
            <DropdownMenuItem
              onClick={() => {
                contextValue.restoreNode(contextMenuState.node!.id);
              }}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Restore
            </DropdownMenuItem>
          ) : contextMenuState.node ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  contextValue.openNode(contextMenuState.node!);
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toggleFavorite(projectId, contextMenuState.node!.id);
                }}
              >
                {favorites[contextMenuState.node.id] ? (
                  <>
                    <StarOff className="w-4 h-4 mr-2" />
                    Remove favorite
                  </>
                ) : (
                  <>
                    <Star className="w-4 h-4 mr-2" />
                    Add favorite
                  </>
                )}
              </DropdownMenuItem>
              {canEdit && contextMenuState.node.type === "folder" && (
                <>
                  <DropdownMenuItem onClick={() => openCreateInFolder(contextMenuState.node!.id, "file")}>
                    <FilePlus2 className="w-4 h-4 mr-2" />
                    New file
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openCreateInFolder(contextMenuState.node!.id, "folder")}>
                    <FolderPlus className="w-4 h-4 mr-2" />
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleUploadToFolder(contextMenuState.node!.id)}>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload file
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openFolderUpload(contextMenuState.node!.id)}>
                    <FolderInput className="w-4 h-4 mr-2" />
                    Upload folder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadFolder(contextMenuState.node!.id)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download ZIP
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && (
                <>
                  <DropdownMenuItem onClick={() => openRename(contextMenuState.node!)}>
                    <Pencil className="w-4 h-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleMoveFromMenu(contextMenuState.node!)}>
                    <FolderInput className="w-4 h-4 mr-2" />
                    Move
                  </DropdownMenuItem>
                  
                  {/* Phase 2e: Multi-file Comparison */}
                  {contextMenuState.node.type === "file" && (
                    <>
                      <DropdownMenuItem
                        onClick={() => {
                          setCompareSourceId(contextMenuState.node!.id);
                          showToast(`Selected "${contextMenuState.node!.name}" for comparison`, "info");
                        }}
                      >
                        <Check className={cn("w-4 h-4 mr-2", compareSourceId === contextMenuState.node.id ? "text-indigo-500" : "opacity-0")} />
                        Select for Comparison
                      </DropdownMenuItem>
                      {compareSourceId && compareSourceId !== contextMenuState.node.id && (
                        <DropdownMenuItem
                          onClick={() => {
                            const base = nodesById[compareSourceId] as ProjectNode;
                            setCompareDialog({
                              open: true,
                              baseNode: base,
                              compareNode: contextMenuState.node!,
                            });
                          }}
                        >
                          <ArrowRightLeft className="w-4 h-4 mr-2" />
                          Compare with Selected
                        </DropdownMenuItem>
                      )}
                    </>
                  )}

                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() => handleDeleteFromMenu(contextMenuState.node!)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Move to trash
                  </DropdownMenuItem>
                </>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ExplorerOperationsHost
        operationsOpen={operationsOpen}
        operations={operations}
        onClear={clearOperations}
        onUndo={(operationId) => void executeUndo(operationId)}
      />

      <ExplorerInsightsHost
        isInsightsOpen={isInsightsOpen}
        selectedNode={selectedNode}
        insightsLoading={insightsLoading}
        insightsError={insightsError}
        linkedTasks={linkedTasks}
        nodeActivity={nodeActivity}
      />

      <ExplorerDialogsHost
        canEdit={canEdit}
        projectId={projectId}
        createDialog={createDialog}
        setCreateDialog={setCreateDialog}
        confirmCreate={async () => {
          await confirmCreate();
        }}
        renameState={renameState}
        setRenameState={setRenameState}
        confirmRename={async () => {
          await confirmRename();
        }}
        deleteDialog={deleteDialog}
        setDeleteDialog={setDeleteDialog}
        confirmDelete={async () => {
          await confirmDelete();
        }}
        moveDialog={moveDialog}
        setMoveDialog={setMoveDialog}
        confirmMove={async () => {
          await confirmMove();
        }}
        quickOpen={quickOpen}
        setQuickOpen={setQuickOpen}
        commandPalette={commandPalette}
        setCommandPalette={setCommandPalette}
        selectedNode={selectedNode}
        storeSelectedNodeIds={storeSelectedNodeIds as string[]}
        nodesById={nodesById as Record<string, ProjectNode>}
        recents={recents as string[]}
        handleSelect={(node) => handleSelect(node)}
        openCreate={openCreate}
        openRename={openRename}
        openMove={openMove}
        openDelete={openDelete}
        toggleFavorite={toggleFavorite}
        getNodePath={getNodePath}
        mode={mode as "default" | "select"}
      />

      {/* Phase 2e: Comparison Dialog */}
      <MultiFileDiffDialog
        open={compareDialog.open}
        onOpenChange={(open) => setCompareDialog((prev) => ({ ...prev, open }))}
        baseNode={compareDialog.baseNode}
        compareNode={compareDialog.compareNode}
      />
    </div>
  );
}
