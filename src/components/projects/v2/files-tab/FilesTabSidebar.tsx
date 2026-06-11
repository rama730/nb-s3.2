// Task 3.1 — `FilesTabSidebar`.
//
// A 280px collapsible sidebar that re-hosts the preserved virtualized
// tree renderer (`ExplorerTree` + `FileTreeItem` + `FileTreeRow`) with a
// trimmed context suitable for the Files tab v3 browse-first experience.
//
// Feature set (per design.md § FilesTabSidebar and tasks.md § 3.1):
//   * Fixed 280px width when visible; 0px + no border when
//     `ui.sidebarCollapsed === true` (Req 2.5–2.7, 15.14).
//   * 32px header row with a collapse toggle (`PanelLeftClose` icon) and
//     an inline `<input type="text">` whose value is debounced 200ms
//     before feeding the ancestor-retention filter.
//   * Inline search: case-insensitive substring match on node name; every
//     ancestor of a matching node stays visible (Req 2.2).
//   * Tree body reuses preserved modules: `ExplorerTree`,
//     `useExplorerBoot`, `useExplorerMutations`, `useExplorerDragDrop`,
//     `useTreeContext`, `ExplorerContextMenu` portal.
//   * Row click → `useNavigateTo(projectId)` (single write path to
//     `currentLocationId`). Tree highlight is driven by `currentLocationId`,
//     NOT by the legacy `selectedNodeId` (Req 21.7 preserves that surface
//     for the Tasks tab).
//   * NO resize handle (Req 15.14). NO multi-select checkboxes (Q1
//     dropped). NO saved-views / outline / source-control / insights /
//     command-palette toggles (Req 15.15–15.18).
//
// Requirements: Req 1.1, Req 1.7, Req 2.1–2.10, Req 15.14–15.18.

"use client";

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PanelLeftClose } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useToast } from "@/components/ui-custom/Toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  FilePlus2,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Pencil,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";

import { useExplorerBoot } from "../explorer/useExplorerBoot";
import { useExplorerDragDrop } from "../explorer/useExplorerDragDrop";
import { useExplorerMutations } from "../explorer/useExplorerMutations";
import { useTreeContext } from "../explorer/ExplorerContextMenu";
import {
  ExplorerTree,
  useRowsToRender,
  useVisibleRows,
} from "../explorer/ExplorerTree";
import {
  EMPTY_ARRAY,
  EMPTY_OBJECT,
} from "../explorer/explorerTypes";
import { useExplorerOperationLog } from "../explorer/useExplorerOperationLog";
import { ExplorerDialogsHost } from "../explorer/ExplorerDialogsHost";

import type { Role } from "./FilesTabRoleContext";
import { useNavigateTo } from "./hooks/useNavigateTo";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import {
  FILES_TAB_SIDEBAR_HEADER_HEIGHT_PX,
  FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS,
  FILES_TAB_SIDEBAR_WIDTH_PX,
  computeVisibleIdsForSearch,
} from "./sidebarSearch";

// Re-export the pure helpers so consumers (Task 3.2 tests, FilesTabMain's
// collapsed-state floating toggle) can depend on a single import path.
export {
  FILES_TAB_SIDEBAR_WIDTH_PX,
  computeVisibleIdsForSearch,
} from "./sidebarSearch";

// ─── Public API ──────────────────────────────────────────────────────

export interface FilesTabSidebarProps {
  projectId: string;
  /** Current user role; only used to gate mutation affordances inside the context menu. */
  role: Role;
  /** Shortcut for `role !== "Role_Viewer"`. Mirrors the design.md prop shape. */
  canEdit: boolean;
  /** Optional project display name used by the empty-state row. */
  projectName?: string;
  /** Mirrors the `syncStatus` prop piped through `FilesTabRoot` → boot hook. */
  syncStatus?: string;
  /** Honored by `useExplorerBoot` to gate data fetching; defaults to `true`. */
  isActive?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────

export function FilesTabSidebar({
  projectId,
  role,
  canEdit,
  projectName,
  syncStatus,
  isActive = true,
}: FilesTabSidebarProps): React.JSX.Element {
  const { showToast } = useToast();

  // ── Store selectors ───────────────────────────────────────────────
  const sidebarCollapsed = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.sidebarCollapsed ?? false,
  );
  const toggleSidebar = useFilesWorkspaceStore((s) => s.toggleSidebar);

  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJECT,
  );
  const childrenByParentId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJECT,
  );
  const loadedChildren = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJECT,
  );
  const expandedFolderIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJECT,
  );
  const folderMeta = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.folderMeta || EMPTY_OBJECT,
  );
  const treeVersion = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.treeVersion || 0,
  );
  const sort = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.sort || "name",
  );
  const foldersFirst = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.foldersFirst ?? true,
  );
  const favorites = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.favorites || EMPTY_OBJECT,
  );
  const recents = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.recents || EMPTY_ARRAY,
  );
  const taskLinkCounts = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT,
  );
  const locksByNodeId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.locksByNodeId || EMPTY_OBJECT,
  );
  const currentLocationId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const selectedFolderId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedFolderId ?? null,
  );
  const storeSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedNodeIds || EMPTY_ARRAY,
  );

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.setSelectedNodeIds,
  );
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);

  // ── Navigation (single write path) ────────────────────────────────
  const navigateTo = useNavigateTo(projectId);

  // ── Inline search (debounced, ancestor retention) ─────────────────
  const [searchInput, setSearchInput] = useState("");
  const [effectiveQuery, setEffectiveQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setEffectiveQuery(searchInput);
    }, FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // ── Performance mark (Req 16.5, Task 11.1) ────────────────────────
  //
  // Emit `files-tab:sidebar-interactive` on the first paint where the
  // sidebar is actually visible (not collapsed). A `useRef` guard keeps
  // the mark idempotent across subsequent re-renders so the single
  // User Timing entry represents the first interactive moment. The
  // `typeof performance !== "undefined"` guard keeps this safe during
  // SSR / non-DOM test environments.
  const sidebarInteractiveMarkedRef = useRef(false);
  useEffect(() => {
    if (sidebarCollapsed) return;
    if (sidebarInteractiveMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:sidebar-interactive");
    sidebarInteractiveMarkedRef.current = true;
  }, [sidebarCollapsed]);

  const visibleIdsFromSearch = useMemo(
    () =>
      computeVisibleIdsForSearch(
        nodesById as Record<string, ProjectNode>,
        effectiveQuery,
      ),
    [nodesById, effectiveQuery],
  );

  // ── Data bootstrapping ────────────────────────────────────────────
  const bootContext = useContext(FilesTabBootContext);
  if (!bootContext) {
    throw new Error("FilesTabSidebar must be used within FilesTabBootContext");
  }
  const { isBooting, accessError, loadFolderContent, handleToggleFolder, handleLoadMore } = bootContext;

  // ── Operations log (powers undo on rename/delete/move) ────────────
  const { operations, recordOperation } = useExplorerOperationLog();
  // `operations` is retained via the useExplorerMutations contract below;
  // we intentionally do not render an operations panel in the v3 sidebar.
  void operations;

  // ── Derived selected node (coerced to the legacy explorer shape) ──
  const selectedNode = currentLocationId
    ? (nodesById as Record<string, ProjectNode>)[currentLocationId] ?? null
    : null;

  // ── Mutations (create / rename / delete / move / upload) ─────────
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
    onOpenFile: (node) => navigateTo(node.id),
    showToast,
    recordOperation,
  });

  // `openUpload` comes from the sidebar-root toolbar which is intentionally
  // absent in the v3 design — expose nothing to the UI but keep the binding
  // so React reports no "unused import" churn in future task branches.
  void openUpload;

  // ── Visible rows (delegates to buildVisibleRows with ancestor filter) ──
  const includeFilter = useMemo(() => {
    if (!visibleIdsFromSearch) return undefined;
    return (node: ProjectNode) => visibleIdsFromSearch.has(node.id);
  }, [visibleIdsFromSearch]);

  // During an active search we want every matching node and its ancestors
  // to render regardless of the stored expand state. Compute a union of
  // the user's expanded folders and the ancestor chain of every match so
  // `buildVisibleRows` traverses through them.
  const expandedForRender = useMemo(() => {
    if (!visibleIdsFromSearch) return expandedFolderIds as Record<string, boolean>;
    const next: Record<string, boolean> = {
      ...(expandedFolderIds as Record<string, boolean>),
    };
    for (const id of visibleIdsFromSearch) {
      const node = (nodesById as Record<string, ProjectNode>)[id];
      if (node?.type === "folder") next[id] = true;
    }
    return next;
  }, [visibleIdsFromSearch, expandedFolderIds, nodesById]);

  const { visibleRows, includeFileByMode } = useVisibleRows({
    projectId,
    treeVersion,
    explorerMode: "tree",
    nodesById: nodesById as Record<string, ProjectNode>,
    childrenByParentId: childrenByParentId as Record<string, string[]>,
    loadedChildren: loadedChildren as Record<string, boolean>,
    expandedFolderIds: expandedForRender,
    folderMeta: folderMeta as Record<
      string,
      { nextCursor: string | null; hasMore: boolean }
    >,
    sort: sort as "name" | "updated" | "type",
    foldersFirst: foldersFirst as boolean,
    viewMode: "all",
  });

  // The Files-tab v3 sidebar renders every node type that survives the
  // ancestor-retention filter. `buildVisibleRows` honours the caller's
  // `includeNode` via `includeFilter`, so we layer the search filter on
  // top of the default view-mode predicate.
  const rowsToRender = useRowsToRender({
    effectiveMode: "tree",
    visibleRows: visibleRows.filter((row) => {
      if (row.kind !== "node") return true;
      if (!includeFilter) return true;
      const node = (nodesById as Record<string, ProjectNode>)[row.nodeId];
      return node ? includeFilter(node) : false;
    }),
    searchResults: [],
    trashNodesState: [],
    favorites: favorites as Record<string, boolean>,
    recents: recents as string[],
    nodesById: nodesById as Record<string, ProjectNode>,
    includeFileByMode,
  });

  // Aria metadata — mirrors ExplorerShell so `FileTreeRow` can render
  // `aria-level` / `aria-posinset` / `aria-setsize`.
  const treeItemMetaByNodeId = useMemo(() => {
    const siblingsByParentId = new Map<string, string[]>();
    for (const row of rowsToRender) {
      if (row.kind !== "node") continue;
      const parentKey = row.parentId ?? "__root__";
      const siblings = siblingsByParentId.get(parentKey) ?? [];
      siblings.push(row.nodeId);
      siblingsByParentId.set(parentKey, siblings);
    }
    const meta: Record<
      string,
      { ariaLevel: number; ariaPosInSet: number; ariaSetSize: number }
    > = {};
    for (const row of rowsToRender) {
      if (row.kind !== "node") continue;
      const siblings = siblingsByParentId.get(row.parentId ?? "__root__") ?? [];
      const pos = siblings.indexOf(row.nodeId);
      meta[row.nodeId] = {
        ariaLevel: row.level + 1,
        ariaPosInSet: pos >= 0 ? pos + 1 : 1,
        ariaSetSize: siblings.length || 1,
      };
    }
    return meta;
  }, [rowsToRender]);

  // ── Folder sizes (cheap aggregation over cached nodes) ────────────
  const folderSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    const nodes = nodesById as Record<string, ProjectNode>;
    for (const id in nodes) {
      const node = nodes[id];
      if (!node) continue;
      if (node.type !== "file" || !node.parentId || !node.size) continue;
      let cursor: string | null = node.parentId;
      let depth = 0;
      const visited = new Set<string>();
      while (cursor) {
        if (visited.has(cursor)) break;
        if (depth >= 50) break;
        visited.add(cursor);
        sizes[cursor] = (sizes[cursor] || 0) + (node.size || 0);
        const parentNode: ProjectNode | undefined = nodes[cursor];
        cursor = parentNode?.parentId ?? null;
        depth += 1;
      }
    }
    return sizes;
  }, [nodesById]);

  // ── Row-click handler: single write path to currentLocationId ─────
  const handleSelect = useCallback(
    (node: ProjectNode) => {
      navigateTo(node.id);
    },
    [navigateTo],
  );

  // ── Drag & drop (preserved — Q4 keep) ─────────────────────────────
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

  // ── Desktop file drop onto a folder row (preserved upload path) ───
  const handleDesktopFileDrop = useCallback(
    (files: File[], targetFolderId: string) => {
      if (!canEdit || files.length === 0) return;
      void uploadFilesDirectly(files, targetFolderId);
    },
    [canEdit, uploadFilesDirectly],
  );

  // ── Context-menu portal state (preserved — Q5 keep) ───────────────
  const [contextMenuState, setContextMenuState] = useState<{
    open: boolean;
    x: number;
    y: number;
    node: ProjectNode | null;
  }>({ open: false, x: 0, y: 0, node: null });

  const handleContextMenu = useCallback(
    (node: ProjectNode, e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenuState({ open: true, x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  // ── Inline rename wiring (preserved) ──────────────────────────────
  const handleRenameChange = useCallback(
    (v: string) => setRenameState((prev) => ({ ...prev, value: v })),
    [setRenameState],
  );
  const handleInlineRenameConfirm = useCallback(() => {
    if (!renameState.nodeId) return;
    void confirmRename();
  }, [renameState.nodeId, confirmRename]);
  const handleInlineRenameCancel = useCallback(() => {
    setRenameState({ nodeId: null, value: "", original: "" });
  }, [setRenameState]);

  // ── Tree context ──────────────────────────────────────────────────
  //
  // We pass `currentLocationId` as `selectedNodeId` so the tree renderer
  // highlights the Files-tab v3 navigation position. `selectedNodeIds` is
  // forced to `[]` and `mode` to `"default"` so the multi-select
  // checkbox column never renders (Q1 dropped, Req 15.15).
  const contextValue = useTreeContext({
    projectId,
    nodesById: nodesById as Record<string, ProjectNode>,
    selectedNodeId: currentLocationId,
    effectiveSelectedNodeIds: EMPTY_ARRAY,
    expandedFolderIds: expandedForRender,
    favorites: favorites as Record<string, boolean>,
    taskLinkCounts: taskLinkCounts as Record<string, number>,
    locksByNodeId: locksByNodeId as Record<
      string,
      { lockedBy: string; lockedByName?: string | null; expiresAt: number }
    >,
    mode: "default",
    canEdit,
    projectName: projectName || "Project",
    effectiveMode: "tree",
    renameNodeId: renameState.nodeId,
    renameValue: renameState.value,
    onRenameChange: handleRenameChange,
    onRenameConfirm: handleInlineRenameConfirm,
    onRenameCancel: handleInlineRenameCancel,
    onDesktopFileDrop: handleDesktopFileDrop,
    folderSizes,
    treeItemMetaByNodeId,
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
    handleTaskLinksClick: () => {
      /* Task-link insights panel is removed in v3 (Req 15.16). */
    },
    toggleFavorite,
    loadFolderContent,
    runUniqueMutation,
    showToast,
    recordOperation,
    // Trash surface is removed from the v3 Files tab (Q3 resolved).
    setTrashNodesState: () => {},
    onContextMenu: handleContextMenu,
  });

  // ── Render ────────────────────────────────────────────────────────
  const collapsedToggleLabel = sidebarCollapsed
    ? "Show sidebar"
    : "Hide sidebar";

  if (sidebarCollapsed) {
    // Collapsed: width 0, no border. A floating expand control sits in
    // its own element so users can re-open the sidebar (Req 2.4–2.5).
    // NOTE: The visible Sidebar_Reopen_Control now lives in FilesTabMain
    // (Req 18.1–18.6). This aside retains zero width for layout purposes.
    return (
      <aside
        data-testid="files-tab-sidebar"
        data-collapsed="true"
        aria-label="File sidebar"
        style={{ width: 0 }}
        className="shrink-0 overflow-hidden"
      />
    );
  }

  return (
    <aside
      data-testid="files-tab-sidebar"
      data-collapsed="false"
      aria-label="File sidebar"
      style={{ width: FILES_TAB_SIDEBAR_WIDTH_PX }}
      className="shrink-0 flex flex-col h-full border-r border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900"
    >
      {/* Header row — 32px with collapse toggle + inline search input */}
      <div
        data-testid="files-tab-sidebar-header"
        style={{ height: FILES_TAB_SIDEBAR_HEADER_HEIGHT_PX }}
        className="shrink-0 flex items-center gap-1 px-2 border-b border-zinc-200 dark:border-white/10"
      >
        <button
          type="button"
          onClick={() => toggleSidebar(projectId)}
          aria-label={collapsedToggleLabel}
          title={collapsedToggleLabel}
          data-testid="files-tab-sidebar-collapse"
          className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search files"
          aria-label="Search files"
          data-testid="files-tab-sidebar-search"
          className="flex-1 min-w-0 h-6 px-2 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300"
        />
      </div>

      {/* Tree body — virtualized via ExplorerTree */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ExplorerTree
          rowsToRender={rowsToRender}
          contextValue={contextValue}
          nodesById={nodesById as Record<string, ProjectNode>}
          childrenByParentId={childrenByParentId}
          effectiveSelectedNodeIds={EMPTY_ARRAY as string[]}
          selectedNodeId={currentLocationId}
          viewMode="code"
          effectiveMode="tree"
          isBooting={isBooting}
          isTrashLoading={false}
          accessError={accessError}
          onSelect={handleSelect}
          onToggleFolder={handleToggleFolder}
          onDropOnFolder={handleDropOnFolder}
        />
      </div>

      {/* Context-menu portal (preserved — Q5 keep) */}
      <DropdownMenu
        open={contextMenuState.open}
        onOpenChange={(open) =>
          setContextMenuState((prev) => ({ ...prev, open }))
        }
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
          {contextMenuState.node ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  if (contextMenuState.node)
                    contextValue.openNode(contextMenuState.node);
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (contextMenuState.node)
                    toggleFavorite(projectId, contextMenuState.node.id);
                }}
              >
                {contextMenuState.node &&
                (favorites as Record<string, boolean>)[
                  contextMenuState.node.id
                ] ? (
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
                  <DropdownMenuItem
                    onClick={() =>
                      openCreateInFolder(contextMenuState.node!.id, "file")
                    }
                  >
                    <FilePlus2 className="w-4 h-4 mr-2" />
                    New file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      openCreateInFolder(
                        contextMenuState.node!.id,
                        "folder",
                      )
                    }
                  >
                    <FolderPlus className="w-4 h-4 mr-2" />
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      handleUploadToFolder(contextMenuState.node!.id)
                    }
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      openFolderUpload(contextMenuState.node!.id)
                    }
                  >
                    <FolderInput className="w-4 h-4 mr-2" />
                    Upload folder
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && (
                <>
                  <DropdownMenuItem
                    onClick={() => openRename(contextMenuState.node!)}
                  >
                    <Pencil className="w-4 h-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleMoveFromMenu(contextMenuState.node!)}
                  >
                    <FolderInput className="w-4 h-4 mr-2" />
                    Move
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() =>
                      handleDeleteFromMenu(contextMenuState.node!)
                    }
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

      {/* Dialogs (create / rename / delete / move) — reuses existing host */}
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
        // Quick Open is owned by FilesTabRoot (Task 7.1), not the sidebar.
        quickOpen={{ open: false, query: "" }}
        setQuickOpen={() => {}}
        // Command palette is removed in v3 (Req 15.11).
        commandPalette={{ open: false, query: "" }}
        setCommandPalette={() => {}}
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
        getNodePath={(node) => buildNodePath(nodesById as Record<string, ProjectNode>, node)}
        mode="default"
      />

      {/* Dev-only guardrails: surface suspicious states as console warnings
          rather than overlays. The test suite reads DOM `data-*` attributes,
          not warning text. */}
      {process.env.NODE_ENV !== "production" && accessError ? (
        <AccessErrorDevWarning error={accessError} />
      ) : null}

      {/* Expose role via data-attribute for future a11y audits — trivial
          no-op at runtime, but stable enough for the test suite. */}
      <span className="sr-only" data-testid="files-tab-sidebar-role">
        {role}
      </span>
    </aside>
  );
}

export default FilesTabSidebar;

// ─── Internal helpers ────────────────────────────────────────────────

function buildNodePath(
  nodesById: Record<string, ProjectNode>,
  node: ProjectNode | null | undefined,
): string {
  if (!node) return "";
  const parts: string[] = [node.name];
  let cursor = node.parentId;
  let guard = 0;
  while (cursor && guard < 256) {
    const parent = nodesById[cursor];
    if (!parent) break;
    parts.unshift(parent.name);
    cursor = parent.parentId;
    guard += 1;
  }
  return parts.join("/");
}

function AccessErrorDevWarning({ error }: { error: string }): null {
  useEffect(() => {
    console.warn("[files-tab-sidebar] access error", { error });
  }, [error]);
  return null;
}
