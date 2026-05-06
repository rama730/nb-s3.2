"use client";

import { CloudUpload } from "lucide-react";

import { cn } from "@/lib/utils";
import { TaskFilesActionMenu } from "@/components/projects/v2/tasks/components/TaskFilesActionMenu";

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

export function TaskFilesEmptyState({
  canEdit,
  isDragActive,
  onPickFiles,
  onPickFolder,
  onPickExisting,
}: TaskFilesEmptyStateProps) {
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
          {isDragActive ? "Drop to attach" : "No task files yet"}
        </h3>
        <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
          Start by attaching the file or folder this task depends on. You can drag items here or
          use one guided entry point to add a new file, folder, or existing project item.
        </p>
      </div>

      <TaskFilesActionMenu
        canEdit={canEdit}
        onPickFiles={onPickFiles}
        onPickFolder={onPickFolder}
        onPickExisting={onPickExisting}
        variant="primary"
      />

      <p className="max-w-sm text-[11px] text-zinc-500 dark:text-zinc-400">
        The system will guide version updates, folder placement, and existing-file linking
        so the task starts cleanly and ends with a clear output.
      </p>

      {!canEdit ? (
        <p className="text-[11px] text-zinc-500">
          You have view-only access to this task. Ask an editor to attach files.
        </p>
      ) : null}
    </div>
  );
}

export default TaskFilesEmptyState;
