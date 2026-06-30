// Task 5.2 — `TaskLinkPopover` component.
//
// Wraps `TaskLinkChip` and renders a click-triggered popover listing
// linked tasks with their title and status. Used by `FolderListRow`,
// `FileTreeRow` (via `FileTreeItem`), and `MetadataStrip`.
//
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5.
//
// The popover fetches linked tasks lazily on open via `useTaskLinks`.
// The count displayed on the chip comes from the store's `taskLinkCounts`
// (updated in realtime via Project_Channel within 500ms per Req 7.4).

"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTaskLinks, type LinkedTask } from "@/hooks/useTaskLinks";

import { TaskLinkChip } from "./TaskLinkChip";

// ─── Props ───────────────────────────────────────────────────────────

export interface TaskLinkPopoverProps {
  projectId: string;
  nodeId: string;
  /** Count from the store's `taskLinkCounts`. Drives the chip display. */
  count: number;
  className?: string;
}

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  bodyMaxHeight: number;
};

const POPOVER_WIDTH_PX = 256;
const POPOVER_GAP_PX = 6;
const VIEWPORT_PADDING_PX = 12;
const POPOVER_MAX_HEIGHT_PX = 240;
const POPOVER_HEADER_HEIGHT_PX = 37;
const POPOVER_MIN_BODY_HEIGHT_PX = 72;

function computePopoverPosition(anchor: DOMRect): PopoverPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    POPOVER_WIDTH_PX,
    Math.max(160, viewportWidth - VIEWPORT_PADDING_PX * 2),
  );
  const maxLeft = Math.max(
    VIEWPORT_PADDING_PX,
    viewportWidth - width - VIEWPORT_PADDING_PX,
  );

  let left = anchor.left;
  if (left > maxLeft) left = maxLeft;
  if (left < VIEWPORT_PADDING_PX) left = VIEWPORT_PADDING_PX;

  const spaceBelow =
    viewportHeight - anchor.bottom - POPOVER_GAP_PX - VIEWPORT_PADDING_PX;
  const spaceAbove = anchor.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX;
  const openAbove =
    spaceBelow < POPOVER_MAX_HEIGHT_PX && spaceAbove > spaceBelow;
  const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow);
  const panelHeight = Math.min(
    POPOVER_MAX_HEIGHT_PX,
    Math.max(
      POPOVER_HEADER_HEIGHT_PX + POPOVER_MIN_BODY_HEIGHT_PX,
      availableHeight,
    ),
  );

  let top = openAbove
    ? anchor.top - POPOVER_GAP_PX - panelHeight
    : anchor.bottom + POPOVER_GAP_PX;
  if (!openAbove && top + panelHeight > viewportHeight - VIEWPORT_PADDING_PX) {
    top = viewportHeight - VIEWPORT_PADDING_PX - panelHeight;
  }
  if (top < VIEWPORT_PADDING_PX) top = VIEWPORT_PADDING_PX;

  return {
    top,
    left,
    width,
    bodyMaxHeight: Math.max(
      POPOVER_MIN_BODY_HEIGHT_PX,
      panelHeight - POPOVER_HEADER_HEIGHT_PX,
    ),
  };
}

// ─── Component ───────────────────────────────────────────────────────

export function TaskLinkPopover({
  projectId,
  nodeId,
  count,
  className,
}: TaskLinkPopoverProps): React.JSX.Element | null {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] =
    React.useState<PopoverPosition | null>(null);

  const updatePopoverPosition = React.useCallback(() => {
    const anchor = containerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setPopoverPosition(computePopoverPosition(anchor));
  }, []);

  React.useEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      return;
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, updatePopoverPosition]);

  // Close popover on outside click
  React.useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const isInTrigger = containerRef.current?.contains(target);
      const isInPopover = popoverRef.current?.contains(target);
      if (!isInTrigger && !isInPopover) {
        setIsOpen(false);
      }
    }
    // Use a timeout so the click that opened the popover doesn't
    // immediately close it.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape
  React.useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleChipClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsOpen((prev) => {
        const next = !prev;
        if (next) requestAnimationFrame(updatePopoverPosition);
        return next;
      });
    },
    [updatePopoverPosition],
  );

  if (count < 1) return null;

  return (
    <div ref={containerRef} className={cn("relative inline-flex", className)}>
      <TaskLinkChip count={count} onClick={handleChipClick} />
      {isOpen &&
        popoverPosition &&
        createPortal(
          <TaskLinkPopoverContent
            projectId={projectId}
            nodeId={nodeId}
            ref={popoverRef}
            position={popoverPosition}
          />,
          document.body,
        )}
    </div>
  );
}

// ─── Popover Content ─────────────────────────────────────────────────

interface TaskLinkPopoverContentProps {
  projectId: string;
  nodeId: string;
  position: PopoverPosition;
}

const TaskLinkPopoverContent = React.forwardRef<
  HTMLDivElement,
  TaskLinkPopoverContentProps
>(function TaskLinkPopoverContent(
  { projectId, nodeId, position }: TaskLinkPopoverContentProps,
  ref,
): React.JSX.Element {
  const { tasks, isLoading, error } = useTaskLinks(projectId, nodeId);

  return (
    <div
      ref={ref}
      data-testid="task-link-popover"
      role="dialog"
      aria-label="Linked tasks"
      className={cn(
        "fixed z-[240] rounded-md border border-zinc-200 bg-white shadow-lg",
        "dark:border-zinc-700 dark:bg-zinc-900",
        "animate-in fade-in-0 zoom-in-95",
      )}
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Linked Tasks
        </h4>
      </div>
      <div
        className="overflow-y-auto"
        style={{ maxHeight: position.bodyMaxHeight }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-xs text-red-500">
            {error}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No linked tasks.
          </div>
        ) : (
          <ul
            role="list"
            className="divide-y divide-zinc-100 dark:divide-zinc-800"
          >
            {tasks.map((task) => (
              <PopoverTaskRow key={task.taskId} task={task} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

// ─── Popover Task Row ────────────────────────────────────────────────

function PopoverTaskRow({ task }: { task: LinkedTask }): React.JSX.Element {
  return (
    <li
      data-testid={`task-link-popover-row-${task.taskId}`}
      className="flex items-center gap-2 px-3 py-2"
    >
      <StatusDot status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
          {task.title}
        </div>
        <div className="text-[10px] capitalize text-zinc-500 dark:text-zinc-400">
          {task.status.replace(/_/g, " ")}
        </div>
      </div>
    </li>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }): React.JSX.Element {
  const colorClass = React.useMemo(() => {
    switch (status) {
      case "done":
        return "bg-emerald-500";
      case "in_progress":
        return "bg-blue-500";
      case "blocked":
        return "bg-red-500";
      default:
        return "bg-zinc-400";
    }
  }, [status]);

  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", colorClass)}
      aria-hidden="true"
    />
  );
}

export default TaskLinkPopover;
