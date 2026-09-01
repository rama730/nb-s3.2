"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder as FolderIcon,
  History,
  Link2Off,
  MoreHorizontal,
  RefreshCcw,
  FolderUp,
  FolderDown,
  Pencil,
  X,
  FolderInput,
  UploadCloud,
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import { extractLabel } from "@/lib/projects/task-file-label";
import type { TaskFileRole } from "@/lib/projects/task-file-intelligence";
import { formatBytes, formatRelativeTime as formatRelative, formatFileActor, formatFileTimestamp } from "../../files-tab/folder/format";

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

type TaskFileAttributionFields = {
  updatedByName?: string | null;
  updatedByUsername?: string | null;
  createdByName?: string | null;
  createdByUsername?: string | null;
  versionUpdatedAt?: Date | string | null;
};

export function getTaskFileAttributionLabel(node: TaskFileAttributionFields): string {
  return formatFileActor(node);
}

export interface TaskFileRowProps {
  node: ProjectNode & TaskFileAttributionFields & { annotation?: string | null };
  canEdit: boolean;
  canManageFiles?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: (node: ProjectNode) => void;
  onOpen?: (node: ProjectNode) => void;
  onShowHistory?: (node: ProjectNode) => void;
  onUnlink?: (node: ProjectNode) => void;
  onReplaceWithNewVersion?: (
    node: ProjectNode,
    file: File,
  ) => Promise<{ success: boolean; error?: string }> | void;
  onContextMenu?: (event: React.MouseEvent) => void;

  // Redesign props
  isDeliverable?: boolean;
  fileRole?: TaskFileRole;
  onMoveToDeliverables?: (node: ProjectNode) => void;
  onMoveToWorkingFiles?: (node: ProjectNode) => void;
  onMoveToReferences?: (node: ProjectNode) => void;
  onLabelChange?: (
    node: ProjectNode & { annotation?: string | null },
    newLabel: string | null,
  ) => void;
  onMoveInProjectFiles?: (node: ProjectNode) => void;
  onPublishToProjectFiles?: (node: ProjectNode) => void;
  isHighlighted?: boolean;
}

export function TaskFileRow({
  node,
  canEdit,
  canManageFiles = false,
  isExpanded,
  onToggleExpanded,
  onOpen,
  onShowHistory,
  onUnlink,
  onReplaceWithNewVersion,
  onContextMenu,
  isDeliverable = false,
  fileRole = isDeliverable ? "deliverable" : "working",
  onMoveToDeliverables,
  onMoveToWorkingFiles,
  onMoveToReferences,
  onLabelChange,
  onMoveInProjectFiles,
  onPublishToProjectFiles,
  isHighlighted = false,
}: TaskFileRowProps) {
  const isFolder = node.type === "folder";
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const version =
    (node as { currentVersion?: number | null }).currentVersion ?? 1;
  const currentLabel = extractLabel(node.annotation);
  const rolePresentation = {
    reference: "Reference",
    working: "Working",
    deliverable: "Deliverable",
  } satisfies Record<TaskFileRole, string>;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState(currentLabel || "");

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingLabel && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditingLabel]);

  // Sync state if external label changes while not editing
  useEffect(() => {
    if (!isEditingLabel) {
      setEditLabelValue(currentLabel || "");
    }
  }, [currentLabel, isEditingLabel]);

  const commitLabelEdit = useCallback(() => {
    setIsEditingLabel(false);
    if (editLabelValue.trim() !== (currentLabel || "")) {
      onLabelChange?.(node, editLabelValue.trim());
    }
  }, [editLabelValue, currentLabel, onLabelChange, node]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitLabelEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditingLabel(false);
        setEditLabelValue(currentLabel || "");
      }
    },
    [commitLabelEdit, currentLabel],
  );

  const handleRowActivate = useCallback(() => {
    if (isFolder) {
      onToggleExpanded?.(node);
    } else {
      onOpen?.(node);
    }
  }, [isFolder, node, onToggleExpanded, onOpen]);

  const handleReplacePicked: React.ChangeEventHandler<HTMLInputElement> =
    useCallback(
      async (event) => {
        const file = event.target.files?.[0];
        if (replaceInputRef.current) replaceInputRef.current.value = "";
        if (!file) return;
        if (!onReplaceWithNewVersion) return;
        if (extensionOf(file.name) !== extensionOf(node.name)) {
          toast.error("A new version must use the same file type.");
          return;
        }
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
        "group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200 shadow-sm",
        "bg-white border-zinc-200 hover:border-indigo-300 hover:shadow-md dark:bg-zinc-900/50 dark:border-zinc-800/80 dark:hover:border-indigo-500/50 dark:hover:bg-zinc-900",
        isHighlighted &&
          "border-indigo-400 ring-2 ring-indigo-200 dark:border-indigo-500 dark:ring-indigo-900/60",
      )}
    >
      {/* Name and icon */}
      <div
        onClick={handleRowActivate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleRowActivate();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`${isFolder ? "Open folder" : "Open file"} ${node.name}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
      >
        {isFolder && (
          <span className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-zinc-400">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-500">
          {isFolder ? (
            <FolderIcon className="h-5 w-5 text-zinc-400" fill="currentColor" />
          ) : (
            <FileIcon name={node.name} mimeType={node.mimeType} isFolder={false} className="h-5 w-5" />
          )}
        </span>

        <span className="min-w-0 flex-1 flex items-center gap-3">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            {node.name}
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px] font-bold",
                fileRole === "reference" && "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300",
                fileRole === "working" && "border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300",
                fileRole === "deliverable" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
              )}
            >
              {rolePresentation[fileRole]}
            </span>
          </span>
          {!isDeliverable &&
            (isEditingLabel ? (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 pl-1.5 pr-1 py-0.5 dark:border-indigo-500/30 dark:bg-indigo-500/10"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={inputRef}
                  data-testid="task-file-row-label-editor"
                  type="text"
                  value={editLabelValue}
                  onChange={(e) => setEditLabelValue(e.target.value)}
                  onBlur={commitLabelEdit}
                  onKeyDown={handleKeyDown}
                  placeholder="Label..."
                  className="w-24 bg-transparent text-[10px] font-medium text-indigo-700 outline-none placeholder:text-indigo-300 dark:text-indigo-300 dark:placeholder:text-indigo-700"
                />
                <button
                  type="button"
                  aria-label={`Clear label for ${node.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditLabelValue("");
                    setIsEditingLabel(false);
                    onLabelChange?.(node, null);
                  }}
                  className="rounded hover:bg-indigo-200/50 text-indigo-400 hover:text-indigo-700 dark:text-indigo-500 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : currentLabel ? (
              <button
                type="button"
                aria-label={`Edit label for ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canEdit) setIsEditingLabel(true);
                }}
                className={cn(
                  "inline-flex flex-shrink-0 items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                  canEdit &&
                    "cursor-text hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors",
                )}
              >
                {currentLabel}
              </button>
            ) : null)}
          {version > 1 && (
            <span className="inline-flex flex-shrink-0 items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              v{version}
            </span>
          )}
          <span title={formatFileTimestamp(node.versionUpdatedAt || node.updatedAt)} className="truncate text-xs text-zinc-400 dark:text-zinc-500">
            {isFolder
              ? "Folder"
              : `${formatBytes(node.size) || "Size not recorded"} · Updated by ${getTaskFileAttributionLabel(node)} · ${formatRelative(node.versionUpdatedAt || node.updatedAt)}`}
          </span>
        </span>
      </div>

      {/* Hover actions */}
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="task-file-row-overflow"
              aria-label={`Options for ${node.name}`}
              className="flex size-11 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="z-[300] w-56 [&_[role=menuitem]]:min-h-10"
            data-testid="task-file-row-overflow-menu"
          >
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
              {node.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {canEdit && !isDeliverable ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setIsEditingLabel(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Label
              </DropdownMenuItem>
            ) : null}

            {canEdit && !isDeliverable && onMoveToDeliverables ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveToDeliverables(node);
                }}
              >
                <FolderUp className="mr-2 h-4 w-4" />
                Move to Deliverables
              </DropdownMenuItem>
            ) : null}

            {canEdit && fileRole !== "reference" && onMoveToReferences ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveToReferences(node);
                }}
              >
                <FolderDown className="mr-2 h-4 w-4" />
                Move to Task References
              </DropdownMenuItem>
            ) : null}

            {canEdit && fileRole !== "working" && onMoveToWorkingFiles ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveToWorkingFiles(node);
                }}
              >
                <FolderDown className="mr-2 h-4 w-4" />
                Move to Working Files
              </DropdownMenuItem>
            ) : null}

            {canManageFiles && !node.taskId && onMoveInProjectFiles ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveInProjectFiles(node);
                }}
              >
                <FolderInput className="mr-2 h-4 w-4" />
                Move in Project Files
              </DropdownMenuItem>
            ) : null}

            {canManageFiles && node.taskId && onPublishToProjectFiles ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onPublishToProjectFiles(node);
                }}
              >
                <UploadCloud className="mr-2 h-4 w-4" />
                Publish to Project Files
              </DropdownMenuItem>
            ) : null}

            {!isFolder && canEdit && onReplaceWithNewVersion ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  replaceInputRef.current?.click();
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Upload new version
              </DropdownMenuItem>
            ) : null}

            {!isFolder ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onShowHistory?.(node);
                }}
              >
                <History className="mr-2 h-4 w-4" />
                Version history (v{version})
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
                >
                  <Link2Off className="mr-2 h-4 w-4" />
                  Remove from task
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
