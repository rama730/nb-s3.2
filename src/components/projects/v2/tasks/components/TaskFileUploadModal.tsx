"use client";

import { useMemo, useState } from "react";
import { BookOpen, FolderDown, FolderUp, RefreshCcw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { FolderPicker } from "@/components/projects/v2/explorer/ExplorerDialogsHost";

export type UploadIntent = "reference" | "working" | "deliverable" | "version";

export interface TaskFileUploadModalProps {
  projectId: string;
  isOpen: boolean;
  files: File[];
  folderCount?: number;
  existingFiles: ProjectNode[];
  onConfirm: (
    intent: UploadIntent,
    targetNodeId?: string,
    label?: string,
  ) => void;
  onCancel: () => void;
}

export function TaskFileUploadModal({
  projectId,
  isOpen,
  files,
  folderCount = 0,
  existingFiles,
  onConfirm,
  onCancel,
}: TaskFileUploadModalProps) {
  const [intent, setIntent] = useState<UploadIntent>("working");
  const [destinationFolderId, setDestinationFolderId] = useState<string | null>(null);
  const [versionNodeId, setVersionNodeId] = useState("");
  const [label, setLabel] = useState<string>("");

  const fileCount = files.length;
  const displayName = folderCount > 0
    ? `${folderCount} folder${folderCount === 1 ? "" : "s"}`
    : fileCount === 1 && files[0] ? files[0].name : `${fileCount} files`;
  const versionCandidates = useMemo(
    () => existingFiles.filter((node) => node.type === "file"),
    [existingFiles],
  );

  const handleConfirm = () => {
    if (intent === "version") {
      onConfirm(intent, versionNodeId);
    } else if (intent === "deliverable") {
      onConfirm(intent, destinationFolderId ?? undefined);
    } else {
      onConfirm(intent, undefined, label.trim() || undefined);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="z-[300] sm:max-w-md" overlayClassName="z-[299]">
        <DialogHeader>
          <DialogTitle>Upload {displayName}</DialogTitle>
          <DialogDescription>
            How would you like to categorize these files?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-4">
          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors",
              intent === "reference"
                ? "border-sky-600 bg-sky-50/50 dark:border-sky-500 dark:bg-sky-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
          >
            <button
              type="button"
              onClick={() => setIntent("reference")}
              aria-pressed={intent === "reference"}
              className="flex w-full items-start gap-3 text-left"
            >
              <BookOpen
                className={cn(
                  "mt-0.5 h-5 w-5",
                  intent === "reference"
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Task Reference
                </div>
                <div className="text-xs text-zinc-500">
                  A brief, specification, example, or source file supplied as task input.
                </div>
              </div>
            </button>
            {intent === "reference" && (
              <div className="mt-3 pl-8">
                <input
                  type="text"
                  placeholder="Optional description or tag..."
                  aria-label="Task reference description or tag"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                  maxLength={100}
                />
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors",
              intent === "working"
                ? "border-indigo-600 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
          >
            <button
              type="button"
              onClick={() => setIntent("working")}
              aria-pressed={intent === "working"}
              className="flex w-full items-start gap-3 text-left"
            >
              <FolderDown
                className={cn(
                  "mt-0.5 h-5 w-5",
                  intent === "working"
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Working File
                </div>
                <div className="text-xs text-zinc-500">
                  Active drafts and intermediate work produced while completing the task.
                </div>
              </div>
            </button>
            {intent === "working" && (
              <div className="mt-3 pl-8">
                <input
                  type="text"
                  placeholder="Optional description or tag..."
                  aria-label="File description or tag"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                  maxLength={100}
                />
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors",
              intent === "deliverable"
                ? "border-emerald-600 bg-emerald-50/50 dark:border-emerald-500 dark:bg-emerald-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
          >
            <button
              type="button"
              onClick={() => setIntent("deliverable")}
              aria-pressed={intent === "deliverable"}
              className="flex w-full items-start gap-3 text-left"
            >
              <FolderUp
                className={cn(
                  "mt-0.5 h-5 w-5",
                  intent === "deliverable"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Final Deliverable
                </div>
                <div className="text-xs text-zinc-500">
                  The completed output of this task. Optionally choose its
                  project folder.
                </div>
              </div>
            </button>
            {intent === "deliverable" && (
              <div className="mt-3 pl-8 max-h-[200px] overflow-y-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
                <FolderPicker
                  projectId={projectId}
                  selectedFolderId={destinationFolderId}
                  onSelectFolder={setDestinationFolderId}
                />
              </div>
            )}
          </div>

          {folderCount === 0 && fileCount === 1 && versionCandidates.length > 0 && (
            <div
              className={cn(
                "flex flex-col rounded-lg border p-3 transition-colors",
                intent === "version"
                  ? "border-amber-600 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-500/10"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setIntent("version");
                  if (!versionNodeId) {
                    const first = versionCandidates[0];
                    if (first) setVersionNodeId(first.id);
                  }
                }}
                aria-pressed={intent === "version"}
                className="flex w-full items-start gap-3 text-left"
              >
                <RefreshCcw
                  className={cn(
                    "mt-0.5 h-5 w-5",
                    intent === "version"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-400",
                  )}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    New Version of Existing File
                  </div>
                  <div className="text-xs text-zinc-500">
                    Add this upload to an attached file&apos;s version history.
                  </div>
                </div>
              </button>

              {intent === "version" && (
                <div className="mt-3 pl-8">
                  <label htmlFor="task-file-version-target" className="sr-only">
                    Existing file
                  </label>
                  <select
                    id="task-file-version-target"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    value={versionNodeId}
                    onChange={(e) => setVersionNodeId(e.target.value)}
                  >
                    <option value="" disabled>
                      Select an existing file...
                    </option>
                    {versionCandidates.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={intent === "version" && !versionNodeId}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
