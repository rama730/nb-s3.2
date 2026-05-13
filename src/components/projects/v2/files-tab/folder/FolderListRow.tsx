// Task 5.1 — `FolderListRow`.
//
// Renders a single row of `FolderListView`. Presentation-only: all data
// (favorite state, git change, updater display name) is passed in via
// props so the row stays stateless and easy to test.
//
// Responsibilities (per tasks.md § 5.1 + design.md § FolderListView):
//   * Row height 40px, 4-column grid matching `FolderListHeader`.
//   * Name cell: icon + name link + `VersionPill` (when `currentVersion > 1`)
//     + favorite star toggle + git change badge (M / A / D).
//   * Git change badge is rendered only when
//     `filesFeatureFlags.wave4GitIntegration` is true AND the caller
//     supplies a change status for the node (Req 12.1, 12.2, 12.5, 12.6).
//   * Click anywhere except the favorite star → `onNavigate(node.id)`
//     (Req 4.7 / 4.8 / 6.1).
//   * Drag-to-move preserved via existing `useExplorerDragDrop` — the
//     row owns the HTML5 drag source / drop target wiring and forwards
//     the target/dragged ids to the parent's `onDropOnFolder` callback
//     (Q4 keep).
//   * Context menu preserved (Q5 keep) — the row forwards the
//     `contextmenu` event to the parent which opens the shared
//     `ExplorerContextMenu` portal.
//   * `canEdit === false` disables drag + hides the star toggle from
//     the tab order (Req 19.3 — viewer cannot activate mutation
//     affordances).

"use client";

import * as React from "react";
import { Star } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { FileIcon } from "../../explorer/FileIcons";
import { VersionPill } from "../VersionPill";
import { formatBytes, formatRelativeTime } from "./format";
import { FOLDER_LIST_GRID_TEMPLATE, FOLDER_LIST_ROW_HEIGHT_PX } from "./layout";

// ─── Types ───────────────────────────────────────────────────────────

export type GitChangeStatus = "modified" | "added" | "deleted";

/** Optional enrichment on `ProjectNode` supplied by the parent view. */
export type FolderListRowNode = ProjectNode & {
  /** Upstream-resolved display label for the "By" column. */
  updatedByName?: string | null;
  /** Upstream-resolved username fallback for the "By" column. */
  updatedByUsername?: string | null;
};

export interface FolderListRowProps {
  projectId: string;
  node: FolderListRowNode;
  /** Toggles drag source + hides the favorite affordance when false. */
  canEdit: boolean;
  /** Renders the favorite star as filled. */
  isFavorite: boolean;
  /** Optional git change status for this node. */
  gitChange?: GitChangeStatus | null;
  /** Feature-flag gate for git change badges (Req 12.1). */
  gitIntegrationEnabled: boolean;
  /** Row click handler. Receives the node id. */
  onNavigate: (nodeId: string) => void;
  /** Favorite star click handler. Receives the node id. */
  onToggleFavorite: (nodeId: string) => void;
  /** Context-menu handler (preserves `ExplorerContextMenu` integration). */
  onContextMenu: (node: FolderListRowNode, event: React.MouseEvent) => void;
  /** Drag-source hook. Called once drag starts. */
  onDragStart: (nodeId: string) => void;
  /** Drag cleanup hook. */
  onDragEnd: () => void;
  /** Drop handler — only folder rows are valid drop targets. */
  onDropOnFolder: (targetFolderId: string, draggedNodeId: string) => void;
  /** Desktop file drop upload target. Only firing when `canEdit` is true. */
  onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;
  className?: string;
}

// ─── Drag-source MIME (matches the tree drag-source in `FileTreeRow`) ─

const NODE_DRAG_MIME = "application/x-nb-node";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractDraggedNodeId(dt: DataTransfer): string | null {
  const raw = dt.getData(NODE_DRAG_MIME).trim();
  if (!raw) return null;
  return UUID_PATTERN.test(raw) ? raw : null;
}

// ─── Field helpers ───────────────────────────────────────────────────

const MISSING = "—" as const;

/** "By" column label with the same fallback order as `MetadataStrip`. */
function updatedByLabel(node: FolderListRowNode): string {
  const name =
    typeof node.updatedByName === "string" ? node.updatedByName.trim() : "";
  if (name.length > 0) return name;
  const username =
    typeof node.updatedByUsername === "string"
      ? node.updatedByUsername.trim()
      : "";
  if (username.length > 0) return username;
  return MISSING;
}

/** Relative-time label for the "Last updated" column. */
function updatedAtLabel(node: FolderListRowNode): string {
  if (node.updatedAt == null) return MISSING;
  const label = formatRelativeTime(node.updatedAt);
  return label === MISSING ? MISSING : label;
}

/** Size label per Req 4.5 — empty for folders, formatBytes for files. */
function sizeLabel(node: FolderListRowNode): string {
  if (node.type === "folder") return "";
  if (node.size == null) return MISSING;
  const label = formatBytes(node.size, "file");
  return label === "" ? MISSING : label;
}

// ─── Git change badge ────────────────────────────────────────────────

const GIT_BADGE_LETTER: Record<GitChangeStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
};

const GIT_BADGE_CLASS: Record<GitChangeStatus, string> = {
  modified:
    "bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
  added:
    "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
  deleted:
    "bg-red-100 text-red-800 ring-1 ring-red-300 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/30",
};

function GitChangeBadge({
  status,
}: {
  status: GitChangeStatus;
}): React.JSX.Element {
  return (
    <span
      data-testid="files-tab-folder-list-git-badge"
      data-status={status}
      title={`Git: ${status}`}
      className={cn(
        "inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm text-[10px] font-bold tabular-nums",
        GIT_BADGE_CLASS[status],
      )}
    >
      {GIT_BADGE_LETTER[status]}
    </span>
  );
}

// ─── Row component ───────────────────────────────────────────────────

export const FolderListRow = React.memo(function FolderListRow({
  projectId: _projectId,
  node,
  canEdit,
  isFavorite,
  gitChange,
  gitIntegrationEnabled,
  onNavigate,
  onToggleFavorite,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDropOnFolder,
  onDesktopFileDrop,
  className,
}: FolderListRowProps): React.JSX.Element {
  const isFolder = node.type === "folder";
  const [dropHighlight, setDropHighlight] = React.useState(false);

  const showGitBadge =
    gitIntegrationEnabled && !!gitChange && !isFolder;

  const handleClick = React.useCallback(() => {
    onNavigate(node.id);
  }, [node.id, onNavigate]);

  const handleFavoriteClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onToggleFavorite(node.id);
    },
    [node.id, onToggleFavorite],
  );

  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(node, e);
    },
    [node, onContextMenu],
  );

  const handleDragStart = React.useCallback(
    (e: React.DragEvent) => {
      if (!canEdit) return;
      e.dataTransfer.setData(NODE_DRAG_MIME, node.id);
      e.dataTransfer.effectAllowed = "move";
      onDragStart(node.id);
    },
    [canEdit, node.id, onDragStart],
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent) => {
      if (!isFolder) return;
      e.preventDefault();
      const hasFiles = e.dataTransfer.types.includes("Files");
      const hasNodeDrag = e.dataTransfer.types.includes(NODE_DRAG_MIME);
      if (!hasFiles && !hasNodeDrag) return;
      e.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
      if (!dropHighlight) setDropHighlight(true);
    },
    [dropHighlight, isFolder],
  );

  const handleDragLeave = React.useCallback(() => {
    if (dropHighlight) setDropHighlight(false);
  }, [dropHighlight]);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      if (!isFolder) return;
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight(false);

      // Desktop file drop → upload into this folder (viewers excluded).
      if (canEdit && e.dataTransfer.files.length > 0 && onDesktopFileDrop) {
        const files = Array.from(e.dataTransfer.files);
        onDesktopFileDrop(files, node.id);
        return;
      }
      if (!canEdit) return;

      if (!e.dataTransfer.types.includes(NODE_DRAG_MIME)) return;
      const draggedId = extractDraggedNodeId(e.dataTransfer);
      if (!draggedId || draggedId === node.id) return;
      onDropOnFolder(node.id, draggedId);
    },
    [canEdit, isFolder, node.id, onDesktopFileDrop, onDropOnFolder],
  );

  const byLabel = updatedByLabel(node);

  return (
    <div
      role="row"
      data-testid="files-tab-folder-list-row"
      data-node-id={node.id}
      data-node-type={node.type}
      style={{
        gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE,
        height: FOLDER_LIST_ROW_HEIGHT_PX,
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(node.id);
        }
      }}
      onContextMenu={handleContextMenu}
      draggable={canEdit}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={0}
      className={cn(
        "group grid cursor-pointer items-center gap-x-3 border-b border-zinc-100 px-4 text-sm outline-none transition-colors",
        "hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400",
        "dark:border-zinc-800 dark:hover:bg-zinc-900/40 dark:focus-visible:bg-zinc-900/40 dark:focus-visible:ring-indigo-500",
        dropHighlight &&
          "bg-indigo-50/70 ring-1 ring-inset ring-indigo-400 dark:bg-indigo-900/30",
        className,
      )}
    >
      {/* Name column */}
      <div
        role="cell"
        data-column="name"
        className="flex min-w-0 items-center gap-2"
      >
        <FileIcon
          name={node.name}
          isFolder={isFolder}
          isOpen={false}
          className="h-4 w-4 shrink-0 text-zinc-500"
        />
        <span
          data-testid="files-tab-folder-list-name"
          className={cn(
            "truncate text-zinc-800 dark:text-zinc-200",
            isFolder && "font-medium",
          )}
          title={node.name}
        >
          {node.name}
        </span>
        <VersionPill v={node.currentVersion} />
        {canEdit || isFavorite ? (
          <button
            type="button"
            onClick={handleFavoriteClick}
            aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
            aria-pressed={isFavorite}
            data-testid="files-tab-folder-list-favorite"
            data-favorite={isFavorite ? "true" : "false"}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors",
              isFavorite
                ? "text-amber-400 hover:text-amber-500"
                : "text-transparent group-hover:text-zinc-400 hover:text-amber-400 focus-visible:text-zinc-500",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400",
            )}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={isFavorite ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        ) : null}
        {showGitBadge ? <GitChangeBadge status={gitChange!} /> : null}
      </div>

      {/* Last updated */}
      <div
        role="cell"
        data-column="updated"
        className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400"
        title={node.updatedAt ? String(node.updatedAt) : undefined}
      >
        {updatedAtLabel(node)}
      </div>

      {/* Size */}
      <div
        role="cell"
        data-column="size"
        className="min-w-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
      >
        {sizeLabel(node)}
      </div>

      {/* By */}
      <div
        role="cell"
        data-column="by"
        className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400"
        title={byLabel}
      >
        {byLabel}
      </div>
    </div>
  );
}, arePropsEqual);

export default FolderListRow;

function arePropsEqual(
  prev: FolderListRowProps,
  next: FolderListRowProps,
): boolean {
  return (
    prev.node === next.node &&
    prev.canEdit === next.canEdit &&
    prev.isFavorite === next.isFavorite &&
    prev.gitChange === next.gitChange &&
    prev.gitIntegrationEnabled === next.gitIntegrationEnabled &&
    prev.onNavigate === next.onNavigate &&
    prev.onToggleFavorite === next.onToggleFavorite &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onDragStart === next.onDragStart &&
    prev.onDragEnd === next.onDragEnd &&
    prev.onDropOnFolder === next.onDropOnFolder &&
    prev.onDesktopFileDrop === next.onDesktopFileDrop &&
    prev.className === next.className
  );
}
