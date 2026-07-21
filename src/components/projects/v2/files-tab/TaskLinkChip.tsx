// Task 5.1 — `TaskLinkChip` component.
//
// Renders a small badge showing the count of tasks linked to a file/folder
// node. Emits `files_tab.task_link_chip_clicked` telemetry on click.
//
// Requirements: 7.1, 7.2, 16.2.
//
// Rendering contract:
//   - Rendered only when `count >= 1` (callers gate on count > 0).
//   - Clicking the chip emits telemetry and forwards the event to the
//     parent via `onClick` so it can open the linked-tasks popover.
"use client";

import * as React from "react";
import { LinkIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

export interface TaskLinkChipProps {
  /** Number of tasks linked to this node. */
  count: number;
  /** Click handler — parent typically opens a linked-tasks popover. */
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}

/**
 * A compact badge indicating how many tasks are linked to a file or folder.
 * Emits telemetry on click and delegates to the parent's `onClick` handler.
 */
export function TaskLinkChip({
  count,
  onClick,
  className,
}: TaskLinkChipProps): React.JSX.Element | null {
  const handleClick = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      logger.metric("files_tab.task_link_chip_clicked", {
        module: "files-tab",
        count,
      });
      onClick(event);
    },
    [count, onClick],
  );

  if (count < 1) return null;

  return (
    <button
      type="button"
      data-testid="files-tab-task-link-chip"
      data-count={count}
      onClick={handleClick}
      aria-label={`${count} linked ${count === 1 ? "task" : "tasks"}`}
      className={cn(
        "inline-flex h-[18px] items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
        "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
        "dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30",
        "cursor-pointer transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/25",
        "focus:outline-none  ",
        className,
      )}
    >
      <LinkIcon className="h-2.5 w-2.5" aria-hidden="true" />
      {count}
    </button>
  );
}

export default TaskLinkChip;
