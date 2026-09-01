// Folder list row: four columns plus favorite, task badge, git badge, and folder drop.

"use client";

import * as React from "react";
import { MoreHorizontal, Star } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { getTaskWorkingFilesDisplayName } from "@/lib/files/task-working-files";

import { FileIcon } from "../../explorer/FileIcons";
import { TaskLinkPopover } from "../TaskLinkPopover";
import { VersionPill } from "../VersionPill";
import { formatBytes, formatRelativeTime, formatFileActor } from "./format";
import { FOLDER_LIST_GRID_TEMPLATE, FOLDER_LIST_ROW_HEIGHT_PX } from "./layout";

// ─── Types ───────────────────────────────────────────────────────────

export type GitChangeStatus = "modified" | "added" | "deleted";

/** Optional enrichment on `ProjectNode` supplied by the parent view. */
export type FolderListRowNode = ProjectNode & {
  /** Latest version uploader id when this row is a file. */
  updatedById?: string | null;
  /** Upstream-resolved display label for the "By" column. */
  updatedByName?: string | null;
  /** Upstream-resolved username fallback for the "By" column. */
  updatedByUsername?: string | null;
  /** Latest version uploader avatar when this row is a file. */
  updatedByAvatarUrl?: string | null;
  /** Latest version upload timestamp when this row is a file. */
  versionUpdatedAt?: Date | string | null;
};

export interface FolderListRowProps {
  projectId: string;
  node: FolderListRowNode;
  /** Toggles drag source + hides the favorite affordance when false. */
  canEdit: boolean;
  canMove?: boolean;
  /** Renders the favorite star as filled. */
  isFavorite: boolean;
  /** Optional git change status for this node. */
  gitChange?: GitChangeStatus | null;
  /** Feature-flag gate for git change badges (Req 12.1). */
  gitIntegrationEnabled: boolean;
  /** Number of tasks linked to this node (from store taskLinkCounts). Req 7.1. */
  taskLinkCount?: number;
  /** Row click handler. Receives the node id. */
  onNavigate: (nodeId: string) => void;
  /** Favorite star click handler. Receives the node id. */
  onToggleFavorite: (nodeId: string) => void;
  /** Context-menu handler (preserves `ExplorerContextMenu` integration). */
  onContextMenu: (node: FolderListRowNode, event: React.MouseEvent) => void;
  /** Drop handler — only folder rows are valid drop targets. */
  onDropOnFolder?: (targetFolderId: string, draggedNodeId: string) => void;
  /** Desktop file drop upload target. Only firing when `canEdit` is true. */
  onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;
  className?: string;
  selected?: boolean;
  onSelectionChange?: (nodeId: string, selected: boolean) => void;
  showActions?: boolean;
  actions?: React.ReactNode;
  subtitle?: string;
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
  return node.type === "folder" ? MISSING : formatFileActor(node);
}

/** Relative-time label for the "Last updated" column. */
function updatedAtLabel(node: FolderListRowNode): string {
  const value = node.versionUpdatedAt ?? node.updatedAt;
  if (value == null) return MISSING;
  const label = formatRelativeTime(value);
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
  projectId,
  node,
  canEdit,
  canMove = canEdit,
  isFavorite,
  gitChange,
  gitIntegrationEnabled,
  taskLinkCount,
  onNavigate,
  onContextMenu,
  onDropOnFolder,
  onDesktopFileDrop,
  className,
  selected = false,
  onSelectionChange,
  showActions = true,
  actions,
  subtitle,
}: FolderListRowProps): React.JSX.Element {
  const isFolder = node.type === "folder";
  const [dropHighlight, setDropHighlight] = React.useState(false);

  const showGitBadge =
    gitIntegrationEnabled && !!gitChange && !isFolder;

  const handleClick = React.useCallback(() => {
    if (onSelectionChange) onSelectionChange(node.id, !selected);
    else onNavigate(node.id);
  }, [node.id, onNavigate, onSelectionChange, selected]);

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
      if (!canMove) return;
      e.dataTransfer.setData(NODE_DRAG_MIME, node.id);
      e.dataTransfer.effectAllowed = "move";
    },
    [canMove, node.id],
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent) => {
      if (!isFolder) return;
      const hasFiles =
        canEdit &&
        Boolean(onDesktopFileDrop) &&
        e.dataTransfer.types.includes("Files");
      const hasNodeDrag =
        canMove &&
        Boolean(onDropOnFolder) &&
        e.dataTransfer.types.includes(NODE_DRAG_MIME);
      if (!hasFiles && !hasNodeDrag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
      if (!dropHighlight) setDropHighlight(true);
    },
    [
      canEdit,
      canMove,
      dropHighlight,
      isFolder,
      onDesktopFileDrop,
      onDropOnFolder,
    ],
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
      if (!canMove || !onDropOnFolder) return;

      if (!e.dataTransfer.types.includes(NODE_DRAG_MIME)) return;
      const draggedId = extractDraggedNodeId(e.dataTransfer);
      if (!draggedId || draggedId === node.id) return;
      onDropOnFolder(node.id, draggedId);
    },
    [
      canEdit,
      canMove,
      isFolder,
      node.id,
      onDesktopFileDrop,
      onDropOnFolder,
    ],
  );

  const byLabel = updatedByLabel(node);
  const updatedLabel = updatedAtLabel(node);
  const displayName = getTaskWorkingFilesDisplayName(node);

  return (
    <div
      role="row"
      aria-selected={onSelectionChange ? selected : undefined}
      data-testid="files-tab-folder-list-row"
      data-node-id={node.id}
      data-node-type={node.type}
      style={{
        gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE,
        minHeight: FOLDER_LIST_ROW_HEIGHT_PX,
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      onContextMenu={handleContextMenu}
      draggable={canMove}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={0}
      className={cn(
        "group grid cursor-pointer items-center gap-x-3 border-b border-zinc-100 px-4 text-sm outline-none transition-colors",
        "hover:bg-zinc-50 focus-visible:bg-zinc-50   ",
        "dark:border-zinc-800 dark:hover:bg-zinc-900/40 dark:focus-visible:bg-zinc-900/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
        dropHighlight &&
          "bg-indigo-50/70 ring-1 ring-inset ring-indigo-400 dark:bg-indigo-900/30",
        className,
        selected && onSelectionChange && "bg-blue-50 dark:bg-blue-950/30",
      )}
    >
      {/* Name column */}
      <div
        role="cell"
        data-column="name"
        className="flex min-w-0 items-center gap-2"
      >
        {canEdit && onSelectionChange && <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${displayName}`} checked={selected} onChange={event => onSelectionChange(node.id, event.target.checked)} className="size-4 accent-blue-600" /></label>}
        <FileIcon
          name={displayName}
          mimeType={node.mimeType}
          isFolder={isFolder}
          isOpen={false}
          className="h-4 w-4 shrink-0 text-zinc-500"
        />
        <div className="min-w-0 flex-1"><span
          data-testid="files-tab-folder-list-name"
          className={cn(
            "block truncate text-zinc-800 dark:text-zinc-200",
            isFolder && "font-medium",
          )}
          title={displayName}
        >
          {displayName}
        </span>
        {subtitle && <span title={subtitle} className="block truncate text-xs text-zinc-500">{subtitle}</span>}
        <span data-file-mobile-meta className="truncate text-xs text-zinc-500">{[updatedLabel, sizeLabel(node), byLabel].filter(label => label && label !== MISSING).join(" · ")}</span></div>
        <VersionPill v={node.currentVersion} />
        {isFavorite && <Star aria-label="Starred" className="size-3.5 shrink-0 text-zinc-500" fill="currentColor" />}
        {showGitBadge ? <GitChangeBadge status={gitChange!} /> : null}
        {(taskLinkCount ?? 0) > 0 ? (
          <TaskLinkPopover
            projectId={projectId}
            nodeId={node.id}
            count={taskLinkCount!}
          />
        ) : null}

      </div>

      {/* Last updated */}
      <div
        role="cell"
        data-column="updated"
        className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400"
        title={node.versionUpdatedAt ? String(node.versionUpdatedAt) : node.updatedAt ? String(node.updatedAt) : undefined}
      >
        {updatedLabel}
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
      <div role="cell" data-column="actions" onClick={event => event.stopPropagation()} className="flex justify-end">{showActions && (actions ?? <button type="button" aria-label={`Actions for ${displayName}`} className="flex size-10 items-center justify-center rounded hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800" onClick={handleContextMenu}><MoreHorizontal aria-hidden="true" className="size-4" /></button>)}</div>
    </div>
  );
});

export default FolderListRow;
