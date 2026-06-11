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
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import { filesFeatureFlags } from "@/lib/features/files";
import { cn } from "@/lib/utils";
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

// ─── Public API ──────────────────────────────────────────────────────

export interface FolderListViewProps {
  projectId: string;
  /** `null` means "project root". */
  folderId: string | null;
  canEdit: boolean;
  /** Display name used by dialogs. */
  projectName?: string;
  /**
   * Whether the tab is currently active. Forwarded to `useExplorerBoot` to
   * gate fetches. Defaults to `true` so standalone mounts (tests) fetch.
   */
  isActive?: boolean;
  /** Sync status surfaced to `useExplorerBoot`. */
  syncStatus?: string;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────

export function FolderListView({
  projectId,
  folderId,
  canEdit,
  projectName: _projectName,
  isActive = true,
  syncStatus,
  className,
}: FolderListViewProps): React.JSX.Element {
  const { showToast } = useToast();

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
  const recents = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.recents || EMPTY_ARRAY,
  ) as string[];
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

  const taskLinkCounts = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT,
  ) as Record<string, number>;

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

  // ── Folder contents (status / children / retry) ───────────────────
  const folder = useFolderContents(projectId, folderId);

  // ── Sorted children per Req 4.2 ────────────────────────────────────
  const sortedChildren = React.useMemo<FolderListRowNode[]>(() => {
    if (folder.status !== "ready") return [];
    return sortFolderListNodes(folder.children) as FolderListRowNode[];
  }, [folder.status, folder.children]);

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
    onOpenFile: (node) => navigateTo(node.id),
    showToast,
    recordOperation,
  });

  // ── Drag & drop (preserved — Q4 keep) ─────────────────────────────
  const { handleDropOnFolder } = useExplorerDragDrop({
    projectId,
    canEdit,
    nodesById,
    storeSelectedNodeIds,
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast,
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

  // HTML5 drag bookkeeping — purely a local pair of callbacks; the
  // actual move is serialized by `useExplorerDragDrop.handleDropOnFolder`.
  const noopDragStart = React.useCallback((_id: string) => {}, []);
  const noopDragEnd = React.useCallback(() => {}, []);

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

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      data-testid="files-tab-folder-list-view"
      role="table"
      aria-label="Folder contents"
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950",
        className,
      )}
    >
      <FolderListHeader projectId={projectId} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {folder.status === "loading" ? (
          <FolderListLoading projectId={projectId} />
        ) : folder.status === "error" ? (
          <FolderListError projectId={projectId} onRetry={folder.retry} />
        ) : sortedChildren.length === 0 ? (
          <FolderListEmpty projectId={projectId} />
        ) : (
          <div role="rowgroup">
            {sortedChildren.map((node) => {
              const gitChange =
                gitIntegrationEnabled && gitChangeByNodeId
                  ? gitChangeByNodeId[node.id] ?? null
                  : null;
              return (
                <FolderListRow
                  key={node.id}
                  projectId={projectId}
                  node={node}
                  canEdit={canEdit}
                  isFavorite={!!favorites[node.id]}
                  gitChange={gitChange}
                  gitIntegrationEnabled={gitIntegrationEnabled}
                  taskLinkCount={taskLinkCounts[node.id] ?? 0}
                  onNavigate={navigateTo}
                  onToggleFavorite={handleToggleFavorite}
                  onContextMenu={handleContextMenu}
                  onDragStart={noopDragStart}
                  onDragEnd={noopDragEnd}
                  onDropOnFolder={handleDropOnFolder}
                  onDesktopFileDrop={canEdit ? handleDesktopFileDrop : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Context-menu portal (preserved — Q5 keep). Gated entirely on
          `canEdit` for mutation entries so `Role_Viewer` never sees
          upload / create / rename / move / delete affordances. */}
      <DropdownMenu
        open={contextMenuState.open}
        onOpenChange={(open) =>
          setContextMenuState((prev) => ({ ...prev, open }))
        }
      >
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
                    handleOpenFromMenu(contextMenuState.node);
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
                favorites[contextMenuState.node.id] ? (
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
                      openCreateInFolder(contextMenuState.node!.id, "folder")
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
        // Quick Open is owned by FilesTabRoot (Task 7.1).
        quickOpen={{ open: false, query: "" }}
        setQuickOpen={() => {}}
        // Command palette is removed in v3 (Req 15.11).
        commandPalette={{ open: false, query: "" }}
        setCommandPalette={() => {}}
        selectedNode={selectedNode}
        storeSelectedNodeIds={storeSelectedNodeIds}
        nodesById={nodesById}
        recents={recents}
        handleSelect={(node) => navigateTo(node.id)}
        openCreate={openCreate}
        openRename={openRename}
        openMove={openMove}
        openDelete={openDelete}
        toggleFavorite={toggleFavorite}
        getNodePath={(node) => buildNodePath(nodesById, node)}
        mode="default"
      />
    </div>
  );
}

export default FolderListView;

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
