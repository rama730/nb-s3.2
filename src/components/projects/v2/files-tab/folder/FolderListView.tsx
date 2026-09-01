// Task 5.1 — `FolderListView`.
//
// GitHub-style four-column file list that renders the children of the
// current folder (or the project root when `folderId === null`). Owns:
//   * data wiring via `useFolderContents` (Task 2.6),
//   * navigation via `useNavigateTo` (Task 2.3),
//   * mutation plumbing via `useExplorerMutations` + `useExplorerDragDrop`
//     (preserved modules per Q4 / Q5),
//   * the context-menu portal identical to the sidebar (Q5),
//   * dialog host for create / rename / delete / move (canEdit-gated).
//
// Requirements: Req 4.1–4.10, Req 7.1–7.2, Req 8.1–8.3, Req 11.1–11.4,
// Req 12.1–12.6. See design.md § FolderListView.

"use client";

import { toast } from "sonner";

import * as React from "react";
import {
  FilePlus2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Star,
  StarOff,
  Trash2,
  Upload,
  MoreHorizontal, Download, Copy, Info, History, ListTodo, ArrowDownWideNarrow,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getProjectNodes } from "@/app/actions/files/nodes";
import { getProjectFileSignedUrl } from "@/app/actions/files/content";
import { useFilesWorkspaceView } from "../FilesWorkspaceViews";
import { FilesWorkspaceMenu, FilesHeaderSlot } from "../FilesWorkspaceHeader";
import type { ProjectNode } from "@/lib/db/schema";
import { filesFeatureFlags } from "@/lib/features/files";
import { cn } from "@/lib/utils";
import {
  isInternalTaskWorkingFilesNode,
  isProjectSystemRoot,
} from "@/lib/files/task-working-files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { EMPTY_ARRAY, EMPTY_OBJECT } from "../../explorer/explorerTypes";
import { useExplorerDragDrop } from "../../explorer/useExplorerDragDrop";
import { useExplorerMutations } from "../../explorer/useExplorerMutations";
import { useExplorerOperationLog } from "../../explorer/useExplorerOperationLog";
import { ExplorerDialogsHost } from "../../explorer/ExplorerDialogsHost";

import { useFolderContents, FilesTabBootContext } from "../hooks/useFolderContents";
import { useNavigateTo } from "../hooks/useNavigateTo";
import { FolderListHeader } from "./FolderListHeader";
import {
  FolderListEmpty,
  FolderListError,
  FolderListLoading,
} from "./FolderListStates";
import {
  FolderListRow,
  type FolderListRowNode,
  type GitChangeStatus,
} from "./FolderListRow";
import { sortFolderListNodes } from "./sort";
import styles from "./FolderList.module.css";

/**
 * Stable empty reference for the git `changedFiles` slice. The store
 * default is an empty array but we still want a single referentially
 * stable fallback so Zustand selector comparisons (`Object.is`) do not
 * treat missing-project workspaces as changing on every render.
 */
const EMPTY_GIT_CHANGED_FILES: readonly {
  nodeId: string;
  status: GitChangeStatus;
}[] = Object.freeze([]) as readonly {
  nodeId: string;
  status: GitChangeStatus;
}[];

// Zustand selectors must return the same fallback reference until the store
// supplies metadata. An inline object here is a new external-store snapshot
// on every render, which makes React retry forever before the folder loads.
const EMPTY_FOLDER_PAGE = Object.freeze({
  nextCursor: null,
  hasMore: false,
});

function showFilesToast(message: string, type: "success" | "error" | "info" | "warning" = "info") {
  if (type === "success") toast.success(message);
  else if (type === "error") toast.error(message);
  else if (type === "warning") toast.warning(message);
  else toast.info(message);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface FolderListViewProps {
  projectId: string;
  /** `null` means "project root". */
  folderId: string | null;
  canEdit: boolean;
  canManageFiles?: boolean;
  className?: string;
  collection?: { menuItems?: React.ReactNode; nodes: FolderListRowNode[]; loading?: boolean; footer?: React.ReactNode; labels?: Record<string, string>; preserveOrder?: boolean; emptyMessage?: string; onUnlink?: (node: FolderListRowNode) => void };
}

// ─── Component ───────────────────────────────────────────────────────

export function FolderListView({
  projectId,
  folderId,
  canEdit,
  canManageFiles = false,
  className,
  collection,
}: FolderListViewProps): React.JSX.Element {
  // ── Store selectors ───────────────────────────────────────────────
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJECT,
  ) as Record<string, ProjectNode>;
  const childrenByParentId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJECT,
  ) as Record<string, string[]>;
  const loadedChildren = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJECT,
  ) as Record<string, boolean>;
  const favorites = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.favorites || EMPTY_OBJECT,
  ) as Record<string, boolean>;
  const sort = useFilesWorkspaceStore(s => s.byProjectId[projectId]?.sort ?? "name");
  const setSort = useFilesWorkspaceStore(s => s.setSort);
  const selectedFolderId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedFolderId ?? null,
  );
  const storeSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedNodeIds || EMPTY_ARRAY,
  ) as string[];
  const gitChangedFiles = useFilesWorkspaceStore(
    (s) =>
      s.byProjectId[projectId]?.git?.changedFiles ?? EMPTY_GIT_CHANGED_FILES,
  );
  const folderPage = useFilesWorkspaceStore(
    (s) =>
      s.byProjectId[projectId]?.folderMeta?.[folderId ?? "__root__"] ??
      EMPTY_FOLDER_PAGE,
  );

  const taskLinkCounts = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT,
  ) as Record<string, number>;
  const currentFolderIsSystemManaged = Boolean(
    folderId && nodesById[folderId] && isInternalTaskWorkingFilesNode(nodesById[folderId]),
  );
  const canEditCurrentFolder = canEdit && !currentFolderIsSystemManaged;
  const workspace = useFilesWorkspaceView();
  const [selectionMode, setSelectionMode] = React.useState(false);
  // Search is committed from the dialog, not on every keystroke. Applying it
  // synchronously prevents stale, clickable rows under a new query label.
  const search = workspace?.query ?? "";

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.setSelectedNodeIds,
  );
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);

  // ── Navigation (single write path to currentLocationId) ───────────
  const navigateTo = useNavigateTo(projectId);

  // ── Explorer boot (provides loadFolderContent + handlers) ─────────
  const bootContext = React.useContext(FilesTabBootContext);
  if (!bootContext) {
    throw new Error("FolderListView must be used within FilesTabBootContext");
  }
  const { loadFolderContent } = bootContext;
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const loadMore = React.useCallback(async () => {
    if (!folderPage.hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      await loadFolderContent(folderId, "append");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load more files",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }, [folderId, folderPage.hasMore, isLoadingMore, loadFolderContent]);

  // ── Folder contents (status / children / retry) ───────────────────
  const cachedFolder = useFolderContents(projectId, folderId, !collection && !search && sort === "name");
  const serverList = useInfiniteQuery({
    queryKey: ["files-directory", projectId, folderId, search, sort],
    enabled: !collection && (!!search || sort !== "name"),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getProjectNodes(projectId, folderId, search, 100, pageParam, { sort }),
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const remoteList = !collection && (!!search || sort !== "name");
  const folder = collection ? { status: collection.loading ? "loading" as const : "ready" as const, children: collection.nodes, retry: () => {}, refreshError: false }
    : remoteList ? { status: serverList.isPending ? "loading" as const : serverList.isError && !serverList.data ? "error" as const : "ready" as const,
        children: serverList.data?.pages.flatMap(page => page.nodes) ?? [], retry: () => { void serverList.refetch(); }, refreshError: serverList.isError && !!serverList.data }
    : cachedFolder;
  const hasMore = !collection && (remoteList ? serverList.hasNextPage : folderPage.hasMore);
  React.useEffect(() => { if (collection) upsertNodes(projectId, collection.nodes); else if (remoteList && serverList.data) upsertNodes(projectId, serverList.data.pages.flatMap(page => page.nodes)); }, [collection, remoteList, serverList.data, projectId, upsertNodes]);

  // ── Sorted children per Req 4.2 ────────────────────────────────────
  const sortedChildren = React.useMemo<FolderListRowNode[]>(() => {
    if (folder.status !== "ready") return [];
    const sorted = !collection || collection.preserveOrder ? folder.children as FolderListRowNode[] : sortFolderListNodes(folder.children, sort) as FolderListRowNode[];
    return folderId === null
      ? sorted.filter((node) => !isProjectSystemRoot(node))
      : sorted;
  }, [folder.status, folder.children, folderId, sort, collection]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrollKey = `${workspace?.view ?? "project"}:${workspace?.taskId ?? ""}:${folderId ?? "root"}:${search}:${sort}`;
  React.useLayoutEffect(() => {
    if (folder.status === "ready" && scrollRef.current) scrollRef.current.scrollTop = workspace?.scrollOffsets.current.get(scrollKey) ?? 0;
  }, [scrollKey, folder.status, workspace?.scrollOffsets]);
  const selectedItems = sortedChildren.filter(node => storeSelectedNodeIds.includes(node.id) && !isInternalTaskWorkingFilesNode(node));
  React.useEffect(() => { setSelectedNodeIds(projectId, []); setSelectionMode(false); }, [projectId, folderId, search, sort, workspace?.view, workspace?.taskId, collection?.preserveOrder, setSelectedNodeIds]);
  const selectItem = React.useCallback((id: string, selected: boolean) => {
    const current = useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds ?? [];
    if (selected && current.length >= 200) { toast.info("Select up to 200 items per operation."); return; }
    setSelectedNodeIds(projectId, selected ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }, [projectId, setSelectedNodeIds]);

  // ── Git change lookup — wave4 flag gates rendering entirely ───────
  const gitIntegrationEnabled = filesFeatureFlags.wave4GitIntegration;
  const gitChangeByNodeId = React.useMemo(() => {
    if (!gitIntegrationEnabled) return null;
    const map: Record<string, GitChangeStatus> = {};
    for (const entry of gitChangedFiles) {
      if (entry && typeof entry.nodeId === "string") {
        map[entry.nodeId] = entry.status;
      }
    }
    return map;
  }, [gitIntegrationEnabled, gitChangedFiles]);

  // ── Operations log + mutations ────────────────────────────────────
  const { recordOperation } = useExplorerOperationLog();

  // The mutations hook expects a `selectedNode`. For the folder-list
  // context, "selected" means the current folder (or null for root).
  const selectedNode = folderId ? nodesById[folderId] ?? null : null;

  const {
    uploadCollisionDialog,
    createDialog,
    setCreateDialog,
    deleteDialog,
    setDeleteDialog,
    moveDialog,
    setMoveDialog,
    renameState,
    setRenameState,
    openCreateInFolder,
    confirmCreate,
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
    uploadFilesDirectly,
    runUniqueMutation,
  } = useExplorerMutations({
    projectId,
    canEdit: canEditCurrentFolder,
    canManageFiles,
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
    onOpenFile: (node) => navigateTo(node.id),
    showToast: showFilesToast,
    recordOperation,
  });

  // ── Drag & drop (preserved — Q4 keep) ─────────────────────────────
  const { handleDropOnFolder } = useExplorerDragDrop({
    projectId,
    canEdit: canEditCurrentFolder,
    canManageFiles,
    nodesById,
    storeSelectedNodeIds,
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast: showFilesToast,
    recordOperation,
  });

  // ── Desktop file drop wiring (viewer-gated at row level) ──────────
  const handleDesktopFileDrop = React.useCallback(
    (files: File[], targetFolderId: string) => {
      if (!canEdit || files.length === 0) return;
      void uploadFilesDirectly(files, targetFolderId);
    },
    [canEdit, uploadFilesDirectly],
  );

  // ── Stable row callbacks ──────────────────────────────────────────
  const handleToggleFavorite = React.useCallback(
    (nodeId: string) => {
      toggleFavorite(projectId, nodeId);
    },
    [projectId, toggleFavorite],
  );

  // ── Context-menu portal state (preserved — Q5 keep) ───────────────
  const [contextMenuState, setContextMenuState] = React.useState<{
    open: boolean;
    x: number;
    y: number;
    node: FolderListRowNode | null;
  }>({ open: false, x: 0, y: 0, node: null });

  const handleContextMenu = React.useCallback(
    (node: FolderListRowNode, e: React.MouseEvent) => {
      setContextMenuState({ open: true, x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const handleOpenFromMenu = React.useCallback(
    (node: FolderListRowNode) => {
      navigateTo(node.id);
    },
    [navigateTo],
  );


  async function downloadNode(node: FolderListRowNode) {
    try { const result = await getProjectFileSignedUrl(projectId, node.id, 300, true); const anchor = document.createElement("a"); anchor.href = result.url; anchor.download = node.name; anchor.rel = "noopener noreferrer"; anchor.click(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Download failed"); }
  }
  async function copyLink(node: FolderListRowNode) {
    const url = new URL(window.location.href); url.searchParams.set("tab", "files"); url.searchParams.set("fileId", node.id); url.searchParams.delete("path");
    try { await navigator.clipboard.writeText(url.toString()); toast.success("File link copied"); } catch { toast.error("Could not copy the link"); }
  }
  function openInspector(node: FolderListRowNode, panel: string) {
    const url = new URL(window.location.href); url.searchParams.set("filesPanel", panel); window.history.replaceState(window.history.state, "", url);
    navigateTo(node.id);
  }
  const renderMenu = (menuNode: FolderListRowNode) => <>          {menuNode ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  if (menuNode)
                    handleOpenFromMenu(menuNode);
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (menuNode)
                    toggleFavorite(projectId, menuNode.id);
                }}
              >
                {menuNode &&
                favorites[menuNode.id] ? (
                  <>
                    <StarOff className="w-4 h-4 mr-2" />
                    Unstar
                  </>
                ) : (
                  <>
                    <Star className="w-4 h-4 mr-2" />
                    Star
                  </>
                )}
              </DropdownMenuItem>
              {menuNode.type === "file" && <DropdownMenuItem onSelect={() => void downloadNode(menuNode)}><Download className="mr-2 size-4" />Download</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => void copyLink(menuNode)}><Copy className="mr-2 size-4" />Copy link</DropdownMenuItem>
              {menuNode.type === "file" && <><DropdownMenuItem onSelect={() => openInspector(menuNode, "details")}><Info className="mr-2 size-4" />Details</DropdownMenuItem><DropdownMenuItem onSelect={() => openInspector(menuNode, "version_history")}><History className="mr-2 size-4" />Versions</DropdownMenuItem>{workspace?.canReadTasks && <DropdownMenuItem onSelect={() => openInspector(menuNode, "linked_tasks")}><ListTodo className="mr-2 size-4" />Linked tasks</DropdownMenuItem>}</>}
              {canEdit && !isInternalTaskWorkingFilesNode(menuNode) && menuNode.type === "folder" && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      openCreateInFolder(menuNode!.id, "file")
                    }
                  >
                    <FilePlus2 className="w-4 h-4 mr-2" />
                    New file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      openCreateInFolder(menuNode!.id, "folder")
                    }
                  >
                    <FolderPlus className="w-4 h-4 mr-2" />
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      handleUploadToFolder(menuNode!.id)
                    }
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      openFolderUpload(menuNode!.id)
                    }
                  >
                    <FolderInput className="w-4 h-4 mr-2" />
                    Upload folder
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && collection?.onUnlink && <DropdownMenuItem onSelect={() => collection.onUnlink?.(menuNode)}><ListTodo className="mr-2 size-4" />Remove from this task</DropdownMenuItem>}
              {canEdit && !isInternalTaskWorkingFilesNode(menuNode) && (
                <>
                  <DropdownMenuItem
                    onClick={() => openRename(menuNode!)}
                  >
                    <Pencil className="w-4 h-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  {canManageFiles ? (
                    <DropdownMenuItem
                      onClick={() => handleMoveFromMenu(menuNode!)}
                    >
                      <FolderInput className="w-4 h-4 mr-2" />
                      Move
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() =>
                      handleDeleteFromMenu(menuNode!)
                    }
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Move to trash
                  </DropdownMenuItem>
                </>
              )}
            </>
          ) : null}</>;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      data-testid="files-tab-folder-list-view"
      className={cn(
        styles.container,
        "flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950",
        className,
      )}
    >
      <FilesWorkspaceMenu projectId={projectId} selectionMode={selectionMode}>
        {selectionMode ? <>
          <DropdownMenuItem onSelect={() => setSelectedNodeIds(projectId, sortedChildren.filter(node => !isInternalTaskWorkingFilesNode(node)).slice(0, 200).map(node => node.id))}>Select loaded items (up to 200)</DropdownMenuItem>
          {canManageFiles && <DropdownMenuItem disabled={!selectedItems.length} onSelect={() => openMove(selectedItems)}><FolderInput className="size-4" />Move…</DropdownMenuItem>}
          <DropdownMenuItem disabled={!selectedItems.length} variant="destructive" onSelect={() => openDelete(selectedItems)}><Trash2 className="size-4" />Move to trash…</DropdownMenuItem>
        </> : <>
          {!collection && <DropdownMenuSub>
            <DropdownMenuSubTrigger><ArrowDownWideNarrow className="size-4" />Sort</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup aria-label="Sort files" value={sort} onValueChange={value => setSort(projectId, value as "name" | "updated" | "type")}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated">Last updated</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="type">File type</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>}
          {collection?.menuItems}
          {!collection && !search && canEditCurrentFolder && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handleUploadToFolder(folderId)}><Upload className="size-4" />Upload files…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFolderUpload(folderId)}><FolderInput className="size-4" />Upload folder…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreateInFolder(folderId, "file")}><FilePlus2 className="size-4" />New file…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreateInFolder(folderId, "folder")}><FolderPlus className="size-4" />New folder…</DropdownMenuItem>
          </>}
          {canEditCurrentFolder && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setSelectionMode(true); setSelectedNodeIds(projectId, []); }}>Select items</DropdownMenuItem></>}
        </>}
      </FilesWorkspaceMenu>
      {selectionMode && <FilesHeaderSlot slot="status"><span role="status">{selectedItems.length} selected</span><button type="button" className="min-h-10 rounded px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => { setSelectionMode(false); setSelectedNodeIds(projectId, []); }}>Done</button></FilesHeaderSlot>}
      <div role="table" aria-label="File listing" className="flex min-h-0 flex-1 flex-col">
      <FolderListHeader sort={collection?.preserveOrder ? undefined : sort} />

      {folder.refreshError ? <div role="status" className="px-4 py-2 text-sm text-amber-700 dark:text-amber-300">Showing cached files. Refresh failed. <button type="button" onClick={folder.retry} className="underline">Retry</button></div> : null}

      <div ref={scrollRef} onScroll={event => { if (folder.status === "ready") workspace?.scrollOffsets.current.set(scrollKey, event.currentTarget.scrollTop); }} className="flex-1 min-h-0 overflow-y-auto">
        {folder.status === "loading" ? (
          <FolderListLoading />
        ) : folder.status === "error" ? (
          <FolderListError onRetry={folder.retry} />
        ) : sortedChildren.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <FolderListEmpty
              className="py-0"
              message={
                collection?.emptyMessage ?? (search ? "No matching files." : currentFolderIsSystemManaged
                  ? "No task files have been added yet"
                  : undefined)
              }
            />
            {!collection && !search && canEditCurrentFolder ? (
              <p className="text-sm text-zinc-500">Use the Files actions menu to upload files or create a file or folder.</p>
            ) : null}
          </div>
        ) : (
          <div role="rowgroup">
            {sortedChildren.map((node) => {
              const isSystemManaged = isInternalTaskWorkingFilesNode(node);
              const gitChange =
                gitIntegrationEnabled && gitChangeByNodeId
                  ? gitChangeByNodeId[node.id] ?? null
                  : null;
              return (
                <FolderListRow
                  key={node.id}
                  projectId={projectId}
                  node={node}
                  canEdit={canEdit && !isSystemManaged}
                  canMove={canManageFiles && !isSystemManaged}
                  selected={storeSelectedNodeIds.includes(node.id)}
                  onSelectionChange={selectionMode ? selectItem : undefined}
                  showActions={true}
                  subtitle={collection?.labels?.[node.id] ?? (search ? (node.path.startsWith("/.system/") ? "Task files" : node.path) : undefined)}
                  actions={<DropdownMenu modal={false}><DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${node.name}`} className="flex size-10 items-center justify-center rounded hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"><MoreHorizontal aria-hidden="true" className="size-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={event => event.stopPropagation()}>{renderMenu(node)}</DropdownMenuContent></DropdownMenu>}
                  isFavorite={!!favorites[node.id]}
                  gitChange={gitChange}
                  gitIntegrationEnabled={gitIntegrationEnabled}
                  taskLinkCount={taskLinkCounts[node.id] ?? 0}
                  onNavigate={navigateTo}
                  onToggleFavorite={handleToggleFavorite}
                  onContextMenu={
                    isSystemManaged
                      ? (_node, event) => event.preventDefault()
                      : handleContextMenu
                  }
                  onDropOnFolder={!isSystemManaged && canManageFiles ? handleDropOnFolder : undefined}
                  onDesktopFileDrop={!isSystemManaged && canEdit ? handleDesktopFileDrop : undefined}
                />
              );
            })}
            {hasMore ? (
              <div className="flex justify-center p-4">
                <button
                  type="button"
                  disabled={isLoadingMore || serverList.isFetchingNextPage}
                  onClick={() => remoteList ? void serverList.fetchNextPage() : void loadMore()}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  {isLoadingMore || serverList.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      </div>
      {collection?.footer}

      {/* Context-menu portal (preserved — Q5 keep). Gated entirely on
          `canEdit` for mutation entries so `Role_Viewer` never sees
          upload / create / rename / move / delete affordances. */}
      <DropdownMenu
        modal={false}
        open={contextMenuState.open}
        onOpenChange={(open) =>
          setContextMenuState((prev) => ({ ...prev, open }))
        }
      >
        {/* The installed Radix DropdownMenu package has no Anchor export.
            This controlled, inert trigger is the supported virtual anchor;
            DropdownMenuContent can therefore flip and shift at viewport edges. */}
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            style={{
              position: "fixed",
              left: contextMenuState.x,
              top: contextMenuState.y,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          sticky="always"
          className="z-50 w-48"
        >
          {contextMenuState.node && renderMenu(contextMenuState.node)}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs (create / rename / delete / move) — reuses existing host */}
      {uploadCollisionDialog}
      <ExplorerDialogsHost
        canEdit={canEditCurrentFolder}
        canManageFiles={canManageFiles}
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
      />
    </div>
  );
}

export default FolderListView;

// ─── Internal helpers ────────────────────────────────────────────────
