"use client";

import { ChevronDown, FolderPlus, Link2, MoreHorizontal, Upload } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TaskFilesActionMenuProps {
  canEdit: boolean;
  disabled?: boolean;
  onPickFiles: () => void;
  onPickFolder?: () => void;
  onPickExisting: () => void;
  trigger?: React.ReactNode;
  variant?: "overflow" | "primary";
}

export function TaskFilesActionMenu({
  canEdit,
  disabled = false,
  onPickFiles,
  onPickFolder,
  onPickExisting,
  trigger,
  variant = "overflow",
}: TaskFilesActionMenuProps) {
  const isDisabled = disabled || !canEdit;

  const defaultTrigger =
    variant === "primary" ? (
      <button
        type="button"
        data-testid="task-files-action-menu-trigger"
        title="Add files"
        disabled={isDisabled}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        <Upload className="h-4 w-4" />
        <span>Add files</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-80" />
      </button>
    ) : (
      <button
        type="button"
        data-testid="task-files-action-menu-trigger"
        aria-label="Add files"
        title="Add files"
        disabled={isDisabled}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isDisabled}>
        {trigger ?? defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[300] w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-zinc-500">
          Add to task
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="task-files-action-upload-file"
          onSelect={(event) => {
            event.preventDefault();
            onPickFiles();
          }}
        >
          <Upload className="mr-2 h-4 w-4" />
          <div className="flex flex-col">
            <span>Upload file</span>
            <span className="text-[10px] text-zinc-500">Add a new file from your computer</span>
          </div>
        </DropdownMenuItem>
        {onPickFolder ? (
          <DropdownMenuItem
            data-testid="task-files-action-upload-folder"
            onSelect={(event) => {
              event.preventDefault();
              onPickFolder();
            }}
          >
            <FolderPlus className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span>Upload folder</span>
              <span className="text-[10px] text-zinc-500">Keep folder structure and resolve placement</span>
            </div>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          data-testid="task-files-action-attach-existing"
          onSelect={(event) => {
            event.preventDefault();
            onPickExisting();
          }}
        >
          <Link2 className="mr-2 h-4 w-4" />
          <div className="flex flex-col">
            <span>Attach existing</span>
            <span className="text-[10px] text-zinc-500">Link a file or folder already in this project</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default TaskFilesActionMenu;
