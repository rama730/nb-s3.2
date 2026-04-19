"use client";

/**
 * Empty-state panel for the task panel's Files tab.
 *
 * Replaces the old "No files linked to this task." text with a fully
 * signposted drop zone + three large action cards. The whole panel is
 * also a drop target — the parent FilesTab already wires the document-
 * level drag handlers and forwards drop events here, so we only need to
 * mirror its `isDragActive` state for the visual treatment.
 *
 * The three cards trigger the same handlers as the header buttons (we
 * accept the callbacks from the parent rather than duplicating the
 * upload pipeline). Cards are buttons, not divs, so the surface is fully
 * keyboard-navigable.
 */

import {
  CloudUpload,
  FolderPlus,
  Link2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface TaskFilesEmptyStateProps {
  canEdit: boolean;
  isDragActive?: boolean;
  /** Triggered by the "Upload files" card — opens the same hidden input
   *  the header button uses. */
  onPickFiles: () => void;
  /** Optional — only rendered when the parent supports folder uploads. */
  onPickFolder?: () => void;
  /** Opens the "Attach existing project file/folder" picker modal. */
  onPickExisting: () => void;
}

interface CardSpec {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  enabled: boolean;
  testId: string;
}

export function TaskFilesEmptyState({
  canEdit,
  isDragActive,
  onPickFiles,
  onPickFolder,
  onPickExisting,
}: TaskFilesEmptyStateProps) {
  const cards: CardSpec[] = [
    {
      key: "upload",
      icon: CloudUpload,
      title: "Upload files",
      description: "Pick one or more files from your computer.",
      onClick: onPickFiles,
      enabled: canEdit,
      testId: "task-files-empty-upload",
    },
  ];

  if (onPickFolder) {
    cards.push({
      key: "folder",
      icon: FolderPlus,
      title: "Upload folder",
      description: "Drop a whole folder; subfolders are preserved.",
      onClick: onPickFolder,
      enabled: canEdit,
      testId: "task-files-empty-folder",
    });
  }

  cards.push({
    key: "existing",
    icon: Link2,
    title: "Attach existing",
    description: "Link a file or folder already in this project.",
    onClick: onPickExisting,
    enabled: canEdit,
    testId: "task-files-empty-existing",
  });

  return (
    <div
      data-testid="task-files-empty-state"
      className={cn(
        "flex h-full flex-col items-center justify-center gap-6 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
        isDragActive
          ? "border-indigo-400 bg-indigo-50/70 dark:border-indigo-400/70 dark:bg-indigo-500/10"
          : "border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/40",
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-indigo-300 dark:ring-zinc-700">
          <CloudUpload className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {isDragActive ? "Drop to attach" : "No files yet"}
        </h3>
        <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
          Drag files or folders here, or pick an option below. Attached
          files open in Cursor, VS Code, or the in-app workspace editor.
        </p>
      </div>

      <div
        className={cn(
          "grid w-full max-w-xl gap-3",
          cards.length === 3
            ? "grid-cols-1 sm:grid-cols-3"
            : "grid-cols-1 sm:grid-cols-2",
        )}
      >
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              data-testid={card.testId}
              disabled={!card.enabled}
              onClick={card.onClick}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border bg-white px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:items-start",
                "border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50/50",
                "dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/5",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:bg-white",
                "dark:disabled:hover:border-zinc-800 dark:disabled:hover:bg-zinc-900",
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                <Icon className="h-4 w-4" />
              </span>
              <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {card.title}
              </span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                {card.description}
              </span>
            </button>
          );
        })}
      </div>

      {!canEdit ? (
        <p className="text-[11px] text-zinc-500">
          You have view-only access to this task. Ask an editor to attach files.
        </p>
      ) : null}
    </div>
  );
}

export default TaskFilesEmptyState;
