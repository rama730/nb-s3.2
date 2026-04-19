"use client";

/**
 * Single row inside the task panel's Files tab.
 *
 * Replaces the dense 22px `FileTreeRow` for task attachments — same data
 * model, but every Wave 1-3 capability gets a permanent, labelled surface
 * so users can find them without right-clicking or hovering:
 *
 *   ┌─ drag handle (hover)                 always-rendered slots ──────┐
 *   │ [≡] [📄]  design-spec.md      [v3]  [Reference]  [ Open ▾ ] [⋯] │
 *   │          245 KB · 2d ago · alice                                 │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 *  • Version chip is rendered for v1 too (muted) so users learn that
 *    clicking it opens the history drawer.
 *  • Role chip is the auto-inferred Deliverable / Reference / Working tag
 *    promoted from the header summary onto each row.
 *  • Primary action is the existing `OpenInIdeMenu` rendered with the
 *    new `variant="primary"` treatment so the chooser is unmissable.
 *  • Overflow menu mirrors the right-click context menu so keyboard +
 *    touch users have parity with mouse users.
 *
 * Folder rows reuse the same shell with no version chip and a simple
 * "Open" button that calls `onOpen` (the parent navigates to the folder).
 *
 * The row is intentionally not memoized — its props are all stable
 * primitives or callbacks coming from the explorer, and React's default
 * reconciliation is fast enough for the typical attachment count (single
 * digits to low hundreds; Virtuoso virtualizes the rest).
 */

import { useCallback, useMemo, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder as FolderIcon,
  GripVertical,
  History,
  Link2Off,
  MoreHorizontal,
  RefreshCcw,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileIcon } from "@/components/projects/v2/explorer/FileIcons";
import { OpenInIdeMenu } from "@/components/projects/v2/tasks/components/OpenInIdeMenu";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import {
  inferTaskFileRole,
  type TaskFileRole,
} from "@/lib/projects/task-file-intelligence";

function formatBytes(bytes?: number | null): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  const diffMs = Date.now() - value.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 60 * 1000) return "just now";
  if (diffMs < 60 * 60 * 1000) {
    const m = Math.round(diffMs / (60 * 1000));
    return `${m}m ago`;
  }
  if (diffMs < day) {
    const h = Math.round(diffMs / (60 * 60 * 1000));
    return `${h}h ago`;
  }
  if (diffMs < 7 * day) {
    const d = Math.round(diffMs / day);
    return `${d}d ago`;
  }
  return value.toLocaleDateString();
}

const ROLE_STYLES: Record<TaskFileRole, { label: string; cls: string }> = {
  deliverable: {
    label: "Deliverable",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30",
  },
  reference: {
    label: "Reference",
    cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30",
  },
  working: {
    label: "Working",
    cls: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700",
  },
};

export interface TaskFileRowProps {
  /** Same node shape used by the rest of the task files surface. */
  node: ProjectNode & { annotation?: string | null };
  /** IDs needed to mint signed URLs / IDE paths inside the action menus. */
  projectId: string;
  projectSlug?: string;
  taskId: string;
  /** Viewer can mutate? Drives drag handle, replace, unlink visibility. */
  canEdit: boolean;

  /** Folder rows only. Toggles expansion in the parent explorer. */
  isExpanded?: boolean;
  /** Folder rows only. Called when the chevron or row is clicked. */
  onToggleExpanded?: (node: ProjectNode) => void;

  /** Drag handle bindings forwarded from the parent's dnd-kit `useSortable`. */
  dragHandleProps?: {
    attributes?: Record<string, unknown>;
    listeners?: Record<string, unknown>;
  };

  /**
   * Primary action callbacks. Kept granular so the row doesn't need to
   * know about the parent's mutation pipeline.
   */
  onOpen?: (node: ProjectNode) => void;
  onShowHistory?: (node: ProjectNode) => void;
  onUnlink?: (node: ProjectNode) => void;
  /**
   * Forwarded from `useTaskFileMutations.saveAsNewVersion`. Triggers a
   * hidden file picker scoped to this row when the user clicks
   * "Replace with new version" in the overflow menu.
   */
  onReplaceWithNewVersion?: (
    node: ProjectNode,
    file: File,
  ) => Promise<{ success: boolean; error?: string }> | void;

  /** Pass-through to OpenInIdeMenu. */
  onOpenInWorkspace?: (node: ProjectNode) => void;
  /** Right-click handler — keep the existing context menu for muscle memory. */
  onContextMenu?: (event: React.MouseEvent) => void;
}

export function TaskFileRow({
  node,
  projectId,
  projectSlug,
  taskId,
  canEdit,
  isExpanded,
  onToggleExpanded,
  dragHandleProps,
  onOpen,
  onShowHistory,
  onUnlink,
  onReplaceWithNewVersion,
  onOpenInWorkspace,
  onContextMenu,
}: TaskFileRowProps) {
  const isFolder = node.type === "folder";
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const role = useMemo<TaskFileRole>(
    () =>
      inferTaskFileRole({
        name: node.name,
        type: node.type,
        path: node.path,
        annotation: node.annotation ?? null,
      }),
    [node.name, node.type, node.path, node.annotation],
  );

  const version =
    (node as { currentVersion?: number | null }).currentVersion ?? 1;
  const hasMultipleVersions = !isFolder && version > 1;

  const handleRowActivate = useCallback(() => {
    if (isFolder) {
      onToggleExpanded?.(node);
      return;
    }
    onOpen?.(node);
  }, [isFolder, node, onOpen, onToggleExpanded]);

  const handleReplacePicked: React.ChangeEventHandler<HTMLInputElement> =
    useCallback(
      async (event) => {
        const file = event.target.files?.[0];
        // Reset right away so picking the same filename twice still fires.
        if (replaceInputRef.current) replaceInputRef.current.value = "";
        if (!file) return;
        if (!onReplaceWithNewVersion) return;
        await onReplaceWithNewVersion(node, file);
      },
      [node, onReplaceWithNewVersion],
    );

  return (
    <div
      data-task-file-row
      data-node-id={node.id}
      data-node-type={node.type}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors",
        "hover:border-zinc-200 hover:bg-zinc-50/80 focus-within:border-indigo-300 focus-within:bg-indigo-50/40",
        "dark:hover:border-zinc-800 dark:hover:bg-zinc-800/40 dark:focus-within:border-indigo-500/40 dark:focus-within:bg-indigo-500/5",
      )}
    >
      {/* Slot 1 — drag handle (hover/focus reveal) */}
      <button
        type="button"
        aria-label="Reorder file"
        disabled={!canEdit}
        {...(dragHandleProps?.attributes ?? {})}
        {...(dragHandleProps?.listeners ?? {})}
        className={cn(
          "flex h-7 w-5 flex-shrink-0 cursor-grab items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity active:cursor-grabbing",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          "hover:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-0 dark:text-zinc-700 dark:hover:text-zinc-400",
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Slot 2 — icon + name + meta. Clicking the slot activates the row. */}
      <button
        type="button"
        onClick={handleRowActivate}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none"
      >
        {/* Folder chevron (only folders) so users can tell at a glance */}
        {isFolder ? (
          <span className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-zinc-400">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        ) : null}

        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
          {isFolder ? (
            <FolderIcon className="h-4 w-4 text-amber-500" />
          ) : (
            <FileIcon
              name={node.name}
              isFolder={false}
              className="h-4 w-4"
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {node.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {isFolder
              ? "Folder"
              : `${formatBytes(node.size)} · Updated ${formatRelative(node.updatedAt)}`}
          </span>
        </span>
      </button>

      {/* Slot 3 — version chip. ALWAYS rendered for files (even v1) so the
          affordance is discoverable. Folders skip this slot. */}
      {!isFolder ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onShowHistory?.(node);
          }}
          title={
            hasMultipleVersions
              ? `Version history — currently v${version}`
              : "Open version history"
          }
          className={cn(
            "inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors",
            hasMultipleVersions
              ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-500/30 dark:hover:bg-indigo-500/25"
              : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-200 hover:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200",
          )}
        >
          <History className="h-2.5 w-2.5" />v{version}
        </button>
      ) : null}

      {/* Slot 4 — role chip (Deliverable / Reference / Working). Auto-inferred. */}
      <span
        className={cn(
          "hidden h-6 flex-shrink-0 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide ring-1 sm:inline-flex",
          ROLE_STYLES[role].cls,
        )}
        title={`Auto-classified as ${ROLE_STYLES[role].label}`}
      >
        {ROLE_STYLES[role].label}
      </span>

      {/* Slot 5 — primary action. Files use the IDE chooser (variant=primary).
          Folders get a simple solid Open button that toggles expansion. */}
      <div
        className="flex-shrink-0"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={() => onToggleExpanded?.(node)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            data-testid="task-file-row-folder-open"
          >
            <FolderIcon className="h-3.5 w-3.5" />
            {isExpanded ? "Hide" : "Open"}
          </button>
        ) : (
          <OpenInIdeMenu
            projectId={projectId}
            projectSlug={projectSlug}
            taskId={taskId}
            node={node}
            variant="primary"
            onOpenInWorkspace={onOpenInWorkspace}
            onAfterDownload={() => onOpen?.(node)}
          />
        )}
      </div>

      {/* Slot 6 — overflow menu. Mirrors the legacy right-click menu so
          keyboard / touch users have parity. */}
      <div
        className="flex-shrink-0"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="task-file-row-overflow"
              aria-label={`More actions for ${node.name}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-zinc-500 transition-colors hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          {/*
            z-[300] keeps the menu above the task detail panel (z-[201]).
            The Radix portal renders into document.body, so it's a
            sibling of the panel — without this override the dropdown
            opens behind the panel and looks like nothing happened.
          */}
          <DropdownMenuContent
            align="end"
            className="z-[300] w-56"
            data-testid="task-file-row-overflow-menu"
          >
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
              {node.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {!isFolder ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onShowHistory?.(node);
                }}
                data-testid="task-file-row-history"
              >
                <History className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span>View version history</span>
                  <span className="text-[10px] text-zinc-500">
                    Currently on v{version}
                  </span>
                </div>
              </DropdownMenuItem>
            ) : null}
            {!isFolder && canEdit && onReplaceWithNewVersion ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  replaceInputRef.current?.click();
                }}
                data-testid="task-file-row-replace"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span>Replace with new version</span>
                  <span className="text-[10px] text-zinc-500">
                    Pick a file from disk to bump to v{version + 1}
                  </span>
                </div>
              </DropdownMenuItem>
            ) : null}
            {canEdit && onUnlink ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onUnlink(node);
                  }}
                  className="text-rose-600 focus:text-rose-600 dark:text-rose-300 dark:focus:text-rose-300"
                  data-testid="task-file-row-unlink"
                >
                  <Link2Off className="mr-2 h-4 w-4" />
                  Unlink from task
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Hidden file picker for "Replace with new version". Scoped to this
          row — the parent never sees the input. */}
      {!isFolder && onReplaceWithNewVersion ? (
        <input
          ref={replaceInputRef}
          type="file"
          className="hidden"
          onChange={handleReplacePicked}
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : null}
    </div>
  );
}

export default TaskFileRow;
