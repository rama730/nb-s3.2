"use client";

import { Loader2 } from "lucide-react";

import type { TaskFileUploadStatus } from "@/hooks/useTaskFileMutations";
import { cn } from "@/lib/utils";

export interface TaskFileUploadQueueListProps {
  queue: TaskFileUploadStatus[];
}

export function TaskFileUploadQueueList({ queue }: TaskFileUploadQueueListProps) {
  if (queue.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {queue.map((item) => {
        const isAwaitingResolution = item.status === "awaiting_resolution";
        const progressLabel =
          item.status === "success"
            ? "Uploaded"
            : item.status === "error"
              ? item.error || "Upload failed"
              : isAwaitingResolution
                ? "Action required — choose whether this should be attached, versioned, or placed under a folder."
                : `${item.progress}%`;

        return (
          <div
            key={item.id}
            className="flex items-center justify-between rounded border bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <div className="min-w-0 flex-1 pr-4">
              <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {item.filename}
              </div>
              <div
                className={cn(
                  "mt-1 truncate text-xs",
                  item.status === "error"
                    ? "text-rose-500"
                    : isAwaitingResolution
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-zinc-500",
                )}
              >
                {progressLabel}
              </div>
            </div>

            {item.status === "uploading" ? (
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div className="h-full bg-indigo-600 transition-all" style={{ width: `${item.progress}%` }} />
              </div>
            ) : item.status === "success" ? (
              <div className="h-4 w-4 rounded-full bg-emerald-500" />
            ) : item.status === "awaiting_resolution" ? (
              <div className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
                Decide
              </div>
            ) : item.status === "error" ? (
              <div className="h-4 w-4 rounded-full bg-rose-500" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default TaskFileUploadQueueList;
