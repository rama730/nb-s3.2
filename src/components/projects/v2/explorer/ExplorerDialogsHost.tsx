"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes } from "@/app/actions/files/nodes";
import { createFolder } from "@/app/actions/files/mutations";
import { isInternalTaskWorkingFilesNode } from "@/lib/files/task-working-files";

// --- FolderPicker (standalone sub-component) ---

export function FolderPicker({
  projectId,
  selectedFolderId,
  onSelectFolder,
  sourceNodes = [],
  canCreateFolder = false,
  allowTaskWorkingFiles = false,
  className,
}: {
  projectId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  sourceNodes?: ProjectNode[];
  canCreateFolder?: boolean;
  allowTaskWorkingFiles?: boolean;
  className?: string;
}) {
  type FolderPage = {
    nodes: ProjectNode[];
    nextCursor: string | null;
    loading: boolean;
    error: string | null;
  };
  const [pages, setPages] = useState<Record<string, FolderPage>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProjectNode[]>([]);
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const keyFor = (parentId: string | null) => parentId ?? "__root__";
  const eligibleFolders = (nodes: ProjectNode[]) =>
    nodes.filter(
      (node) =>
        node.type === "folder" && !isInternalTaskWorkingFilesNode(node),
    );

  const loadPage = async (
    parentId: string | null,
    cursor?: string | null,
    append = false,
  ) => {
    const key = keyFor(parentId);
    setPages((current) => ({
      ...current,
      [key]: {
        nodes: append ? current[key]?.nodes ?? [] : [],
        nextCursor: current[key]?.nextCursor ?? null,
        loading: true,
        error: null,
      },
    }));
    try {
      const result = await getProjectNodes(
        projectId,
        parentId,
        undefined,
        100,
        cursor ?? undefined,
      );
      setPages((current) => ({
        ...current,
        [key]: {
          nodes: append
            ? [...(current[key]?.nodes ?? []), ...eligibleFolders(result.nodes)]
            : eligibleFolders(result.nodes),
          nextCursor: result.nextCursor,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      setPages((current) => ({
        ...current,
        [key]: {
          nodes: current[key]?.nodes ?? [],
          nextCursor: current[key]?.nextCursor ?? null,
          loading: false,
          error:
            error instanceof Error ? error.message : "Could not load folders",
        },
      }));
    }
  };

  useEffect(() => {
    setPages({});
    setExpanded({});
    setQuery("");
    void loadPage(null);
    // loadPage is intentionally reset with the project identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setSearchResults([]);
      setSearchNextCursor(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void getProjectNodes(projectId, null, normalized, 100)
        .then((result) => {
          if (!cancelled) {
            setSearchResults(eligibleFolders(result.nodes));
            setSearchNextCursor(result.nextCursor);
          }
        })
        .catch((error) => {
          if (!cancelled)
            setSearchError(
              error instanceof Error ? error.message : "Search failed",
            );
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, query]);

  const disabledReason = (node: ProjectNode | null) => {
    if (!allowTaskWorkingFiles && sourceNodes.some((source) => source.taskId))
      return "Publish task working files before relocating them";
    if (node && sourceNodes.some((source) => source.id === node.id))
      return "An item cannot be moved into itself";
    if (
      node &&
      sourceNodes.some(
        (source) =>
          source.type === "folder" && node.path.startsWith(`${source.path}/`),
      )
    )
      return "A folder cannot be moved into its descendant";
    const targetId = node?.id ?? null;
    if (
      sourceNodes.length > 0 &&
      sourceNodes.every((source) => (source.parentId ?? null) === targetId)
    )
      return "Items are already in this location";
    return null;
  };

  const loadMoreSearchResults = async () => {
    if (!searchNextCursor || searching) return;
    setSearching(true);
    try {
      const result = await getProjectNodes(
        projectId,
        null,
        query.trim(),
        100,
        searchNextCursor,
      );
      setSearchResults((current) => [
        ...current,
        ...eligibleFolders(result.nodes),
      ]);
      setSearchNextCursor(result.nextCursor);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const toggle = async (node: ProjectNode) => {
    const isOpen = !!expanded[node.id];
    if (isOpen) {
      setExpanded((p) => ({ ...p, [node.id]: false }));
      return;
    }
    setExpanded((p) => ({ ...p, [node.id]: true }));
    if (pages[keyFor(node.id)]) return;
    await loadPage(node.id);
  };

  const focusSibling = (event: React.KeyboardEvent, offset: number) => {
    const tree = event.currentTarget.closest('[role="tree"]');
    const items = Array.from(
      tree?.querySelectorAll<HTMLElement>('[data-folder-tree-item="true"]') ??
        [],
    );
    const index = items.indexOf(event.currentTarget as HTMLElement);
    items[index + offset]?.focus();
  };

  const renderNode = (
    node: ProjectNode,
    level: number,
    position = 1,
    setSize = 1,
  ) => {
    const isOpen = !!expanded[node.id];
    const isSelected = selectedFolderId === node.id;
    const page = pages[keyFor(node.id)];
    const reason = disabledReason(node);
    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-1 rounded-md",
            isSelected && "bg-blue-50 dark:bg-blue-900/20",
            reason && "opacity-55",
          )}
          style={{ paddingLeft: `${level * 14 + 8}px` }}
        >
          <button
            type="button"
            className="inline-flex h-8 w-5 items-center justify-center text-zinc-500"
            onClick={() => void toggle(node)}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            role="treeitem"
            data-folder-tree-item="true"
            aria-level={level + 1}
            aria-posinset={position}
            aria-setsize={setSize}
            aria-expanded={isOpen}
            aria-selected={isSelected}
            aria-disabled={Boolean(reason)}
            title={reason ?? node.path}
            onClick={() => !reason && onSelectFolder(node.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusSibling(event, 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusSibling(event, -1);
              } else if (event.key === "ArrowRight" && !isOpen) {
                event.preventDefault();
                void toggle(node);
              } else if (event.key === "ArrowLeft" && isOpen) {
                event.preventDefault();
                void toggle(node);
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
          >
            {isOpen ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-blue-500" />
            )}
            <span className="truncate">{node.name}</span>
            {isSelected ? (
              <Check className="ml-auto h-4 w-4 shrink-0 text-blue-600" />
            ) : null}
          </button>
        </div>
        {isOpen ? (
          page?.loading && page.nodes.length === 0 ? (
            <div
              className="px-2 py-1.5 text-xs text-zinc-500"
              style={{ paddingLeft: `${(level + 1) * 14 + 8}px` }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : page?.error ? (
            <button
              type="button"
              onClick={() => void loadPage(node.id)}
              className="flex items-center gap-2 py-1.5 text-xs text-rose-600"
              style={{ paddingLeft: `${(level + 1) * 14 + 8}px` }}
            >
              <AlertCircle className="h-3.5 w-3.5" /> {page.error}. Retry
            </button>
          ) : (
            <>
              {(page?.nodes ?? []).map((child, index, siblings) =>
                renderNode(child, level + 1, index + 1, siblings.length),
              )}
              {page?.nextCursor ? (
                <button
                  type="button"
                  disabled={page.loading}
                  onClick={() =>
                    void loadPage(node.id, page.nextCursor, true)
                  }
                  className="py-1.5 text-xs text-blue-600 disabled:opacity-50"
                  style={{ marginLeft: `${(level + 1) * 14 + 8}px` }}
                >
                  {page.loading ? "Loading…" : "Load more folders"}
                </button>
              ) : null}
            </>
          )
        ) : null}
      </div>
    );
  };

  const allLoadedNodes = Object.values(pages).flatMap((page) => page.nodes);
  const selectedNode =
    allLoadedNodes.find((node) => node.id === selectedFolderId) ??
    searchResults.find((node) => node.id === selectedFolderId);
  const rootPage = pages[keyFor(null)];
  const rootReason = disabledReason(null);

  const createSelectedFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createFolder(projectId, selectedFolderId, name);
      setNewFolderName("");
      await loadPage(selectedFolderId);
      onSelectFolder(created.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create folder");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className={cn(
        "flex max-h-[32rem] min-h-64 flex-col overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800",
        className,
      )}
    >
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search project folders"
            aria-label="Search project folders"
            className="pl-8"
          />
        </label>
      </div>
      <div
        role="tree"
        aria-label="Destination folders"
        className="min-h-0 flex-1 overflow-auto py-1"
      >
        {query.trim().length >= 2 ? (
          searching ? (
            <div className="flex items-center gap-2 p-3 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : searchError ? (
            <div className="p-3 text-sm text-rose-600">{searchError}</div>
          ) : searchResults.length ? (
            <>
              {searchResults.map((node, index) =>
                renderNode(node, 0, index + 1, searchResults.length)
              )}
              {searchNextCursor ? (
                <button type="button" onClick={() => void loadMoreSearchResults()} className="mx-3 my-2 text-xs text-blue-600">
                  Load more matches
                </button>
              ) : null}
            </>
          ) : (
            <div className="p-3 text-sm text-zinc-500">
              No eligible folders found.
            </div>
          )
        ) : (
          <>
            <button
              type="button"
              role="treeitem"
              data-folder-tree-item="true"
              aria-level={1}
              aria-posinset={1}
              aria-setsize={(rootPage?.nodes.length ?? 0) + 1}
              aria-selected={selectedFolderId === null}
              aria-disabled={Boolean(rootReason)}
              title={rootReason ?? "Project root"}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900",
                selectedFolderId === null &&
                  "bg-blue-50 dark:bg-blue-900/20",
                rootReason && "opacity-55",
              )}
              onClick={() => !rootReason && onSelectFolder(null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusSibling(event, 1);
                }
              }}
            >
              <Folder className="h-4 w-4 text-blue-500" /> Project root
              {selectedFolderId === null ? (
                <Check className="ml-auto h-4 w-4 text-blue-600" />
              ) : null}
            </button>
            {rootPage?.loading && rootPage.nodes.length === 0 ? (
              <div className="flex items-center gap-2 p-3 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading folders…
              </div>
            ) : rootPage?.error ? (
              <button
                type="button"
                onClick={() => void loadPage(null)}
                className="flex items-center gap-2 p-3 text-sm text-rose-600"
              >
                <AlertCircle className="h-4 w-4" /> {rootPage.error}. Retry
              </button>
            ) : (
              rootPage?.nodes.map((node, index, siblings) =>
                renderNode(node, 0, index + 2, siblings.length + 1),
              )
            )}
            {rootPage?.nextCursor ? (
              <button
                type="button"
                disabled={rootPage.loading}
                onClick={() =>
                  void loadPage(null, rootPage.nextCursor, true)
                }
                className="mx-3 my-2 text-xs text-blue-600 disabled:opacity-50"
              >
                {rootPage.loading ? "Loading…" : "Load more folders"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        Destination:{" "}
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {selectedFolderId === null
            ? "Project root"
            : selectedNode?.path ?? "Select a folder"}
        </span>
      </div>
      {canCreateFolder ? (
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <div className="flex gap-2">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createSelectedFolder();
              }}
              placeholder="New folder name"
              aria-label="New folder name"
            />
            <Button
              type="button"
              variant="outline"
              disabled={
                !newFolderName.trim() ||
                creating ||
                Boolean(disabledReason(selectedNode ?? null))
              }
              onClick={() => void createSelectedFolder()}
            >
              <Plus className="mr-1 h-4 w-4" /> Create
            </Button>
          </div>
          {createError ? <p role="alert" className="mt-1 text-xs text-rose-600">{createError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// --- Dialog components (inlined from deleted ExplorerBatchOps) ---

export function CreateDialog({
  createDialog,
  setCreateDialog,
  confirmCreate,
  canEdit,
}: {
  createDialog:
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string };
  setCreateDialog: React.Dispatch<
    React.SetStateAction<
      | { open: false }
      | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
    >
  >;
  confirmCreate: () => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <Dialog
      open={createDialog.open}
      onOpenChange={(open) => setCreateDialog(open ? createDialog : { open: false })}
    >
      {createDialog.open ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createDialog.kind === "folder" ? "Create folder" : "Create file"}
            </DialogTitle>
            <DialogDescription>
              {createDialog.kind === "folder"
                ? "Create a new folder in the current location."
                : "Create a new file in the current location."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder={
                createDialog.kind === "folder" ? "Folder name" : "File name (e.g. index.tsx)"
              }
              value={createDialog.name}
              onChange={(e) =>
                setCreateDialog((d) => (d.open ? { ...d, name: e.target.value } : d))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmCreate();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog({ open: false })}>
              Cancel
            </Button>
            <Button onClick={() => void confirmCreate()} disabled={!canEdit}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function RenameDialog({
  renameState,
  setRenameState,
  confirmRename,
  canEdit,
}: {
  renameState: { nodeId: string | null; value: string; original: string };
  setRenameState: React.Dispatch<
    React.SetStateAction<{ nodeId: string | null; value: string; original: string }>
  >;
  confirmRename: () => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <Dialog
      open={!!renameState.nodeId}
      onOpenChange={(open) => {
        if (!open) setRenameState({ nodeId: null, value: "", original: "" });
      }}
    >
      {renameState.nodeId ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="New name"
              value={renameState.value}
              onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameState({ nodeId: null, value: "", original: "" })}
            >
              Cancel
            </Button>
            <Button onClick={() => void confirmRename()} disabled={!canEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function DeleteDialog({
  deleteDialog,
  setDeleteDialog,
  confirmDelete,
  canEdit,
}: {
  deleteDialog: { open: boolean; nodes: ProjectNode[] };
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ open: boolean; nodes: ProjectNode[] }>>;
  confirmDelete: () => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <Dialog
      open={deleteDialog.open}
      onOpenChange={(open) =>
        setDeleteDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
      }
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Trash</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          This will move{" "}
          <span className="font-mono font-semibold">
            {deleteDialog.nodes.length > 1
              ? `${deleteDialog.nodes.length} items`
              : deleteDialog.nodes[0]?.name}
          </span>{" "}
          to Trash.
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteDialog({ open: false, nodes: [] })}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={!canEdit}
          >
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  moveDialog,
  setMoveDialog,
  confirmMove,
  canEdit,
  projectId,
  mode = "move",
}: {
  moveDialog: {
    open: boolean;
    nodes: ProjectNode[];
    targetFolderId: string | null;
  };
  setMoveDialog: React.Dispatch<
    React.SetStateAction<{
      open: boolean;
      nodes: ProjectNode[];
      targetFolderId: string | null;
    }>
  >;
  confirmMove: () => Promise<void>;
  canEdit: boolean;
  projectId: string;
  mode?: "move" | "publish";
}) {
  const [isMoving, setIsMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const sourceLabel =
    moveDialog.nodes.length > 1
      ? `${moveDialog.nodes.length} items`
      : moveDialog.nodes[0]?.name ?? "item";
  const invalidReason = mode === "move" && moveDialog.nodes.some((node) => node.taskId)
    ? "Task working files must be published before they can be relocated."
    : moveDialog.nodes.length > 0 &&
        moveDialog.nodes.every(
          (node) => (node.parentId ?? null) === moveDialog.targetFolderId,
        )
      ? "The selected items are already in this location."
      : moveDialog.nodes.some((node) => node.id === moveDialog.targetFolderId)
        ? "An item cannot be moved into itself."
        : null;

  const runMove = async () => {
    if (invalidReason || isMoving) return;
    setMoveError(null);
    setIsMoving(true);
    try {
      await confirmMove();
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Move failed");
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Dialog
      open={moveDialog.open}
      onOpenChange={(open) =>
        setMoveDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
      }
    >
      <DialogContent
        className="z-[301] flex max-h-[88vh] flex-col sm:max-w-2xl"
        overlayClassName="z-[300] bg-zinc-950/60"
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "publish" ? "Publish" : "Move"}{" "}
            {moveDialog.nodes.length > 1 ? "items" : moveDialog.nodes[0]?.type ?? "item"}
          </DialogTitle>
          <DialogDescription>
            {mode === "publish"
              ? "Choose where this task working file should become available in Project Files. Its task role is unchanged."
              : "Choose a new location in Project Files. Task role and final-deliverable status are unchanged."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            Moving <span className="font-mono font-semibold">{sourceLabel}</span>
            {moveDialog.nodes.length === 1 && moveDialog.nodes[0]?.path ? (
              <span className="mt-1 block truncate text-xs text-zinc-500">
                Current location: {moveDialog.nodes[0].path}
              </span>
            ) : null}
          </div>
          <FolderPicker
            projectId={projectId}
            selectedFolderId={moveDialog.targetFolderId}
            onSelectFolder={(id) => setMoveDialog((d) => ({ ...d, targetFolderId: id }))}
            sourceNodes={moveDialog.nodes}
            canCreateFolder={canEdit}
            allowTaskWorkingFiles={mode === "publish"}
            className="h-[min(58vh,32rem)] max-h-none"
          />
          {invalidReason || moveError ? (
            <p role="alert" className="text-sm text-rose-600">
              {moveError ?? invalidReason}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              setMoveDialog({ open: false, nodes: [], targetFolderId: null })
            }
          >
            Cancel
          </Button>
          <Button onClick={() => void runMove()} disabled={!canEdit || isMoving || Boolean(invalidReason)}>
            {isMoving ? (mode === "publish" ? "Publishing…" : "Moving…") : mode === "publish" ? "Publish" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main ExplorerDialogsHost ---

interface ExplorerDialogsHostProps {
  canEdit: boolean;
  canManageFiles?: boolean;
  projectId: string;
  createDialog: { open: false } | { open: true; kind: "file" | "folder"; parentId: string | null; name: string };
  setCreateDialog: React.Dispatch<
    React.SetStateAction<{ open: false } | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }>
  >;
  confirmCreate: () => Promise<void>;
  renameState: { nodeId: string | null; value: string; original: string };
  setRenameState: React.Dispatch<
    React.SetStateAction<{ nodeId: string | null; value: string; original: string }>
  >;
  confirmRename: () => Promise<void>;
  deleteDialog: { open: boolean; nodes: ProjectNode[] };
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ open: boolean; nodes: ProjectNode[] }>>;
  confirmDelete: () => Promise<void>;
  moveDialog: { open: boolean; nodes: ProjectNode[]; targetFolderId: string | null };
  setMoveDialog: React.Dispatch<
    React.SetStateAction<{ open: boolean; nodes: ProjectNode[]; targetFolderId: string | null }>
  >;
  confirmMove: () => Promise<void>;
}

// FW10: Memoize to prevent re-renders from unrelated ExplorerShell state changes
export const ExplorerDialogsHost = React.memo(function ExplorerDialogsHost({
  canEdit,
  canManageFiles = canEdit,
  projectId,
  createDialog,
  setCreateDialog,
  confirmCreate,
  renameState,
  setRenameState,
  confirmRename,
  deleteDialog,
  setDeleteDialog,
  confirmDelete,
  moveDialog,
  setMoveDialog,
  confirmMove,
}: ExplorerDialogsHostProps) {
  return (
    <>
      <CreateDialog
        createDialog={createDialog}
        setCreateDialog={setCreateDialog}
        confirmCreate={confirmCreate}
        canEdit={canEdit}
      />

      <RenameDialog
        renameState={renameState}
        setRenameState={setRenameState}
        confirmRename={confirmRename}
        canEdit={canEdit}
      />

      <DeleteDialog
        deleteDialog={deleteDialog}
        setDeleteDialog={setDeleteDialog}
        confirmDelete={confirmDelete}
        canEdit={canEdit}
      />

      <MoveDialog
        moveDialog={moveDialog}
        setMoveDialog={setMoveDialog}
        confirmMove={confirmMove}
        canEdit={canManageFiles}
        projectId={projectId}
      />
    </>
  );
});
