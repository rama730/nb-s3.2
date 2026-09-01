"use client";

import * as React from "react";
import { Popover } from "radix-ui";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTaskTitlePresentation } from "@/lib/projects/task-presentation";
import { useTaskLinks, type LinkedTask } from "@/hooks/useTaskLinks";
import { TaskLinkChip } from "./TaskLinkChip";
import { taskFilesHref } from "@/lib/files/task-navigation";
import { confirmFileNavigation } from "@/lib/files/unsaved-navigation";

export interface TaskLinkPopoverProps {
  projectId: string;
  nodeId: string;
  count: number;
  className?: string;
}

/** Reuse Radix for collision handling, nested scroll, focus and dismissal. */
export function TaskLinkPopover({
  projectId, nodeId, count, className,
}: TaskLinkPopoverProps): React.JSX.Element | null {
  const [isOpen, setIsOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  if (count < 1) return null;
  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Anchor asChild>
        <div ref={anchorRef} className={cn("inline-flex", className)}>
          <TaskLinkChip
            count={count}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            onClick={() => setIsOpen((open) => !open)}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={12}
          align="start"
          data-testid="task-link-popover"
          aria-label="Linked tasks"
          className="z-[240] flex w-64 max-w-[calc(100vw-24px)] max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            anchorRef.current?.querySelector("button")?.focus();
          }}
        >
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Linked tasks</h4>
          </div>
          <TaskLinkPopoverContent projectId={projectId} nodeId={nodeId} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TaskLinkPopoverContent({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const { tasks, isLoading, error, refresh } = useTaskLinks(projectId, nodeId);
  return (
    <div className="min-h-0 overflow-y-auto">
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
        </div>
      ) : error ? (
        <div role="alert" className="px-3 py-4 text-center text-xs text-red-500">{error} <button type="button" className="min-h-10 px-2 underline" onClick={() => void refresh()}>Retry</button></div>
      ) : tasks.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-zinc-500">No linked tasks.</div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {tasks.map((task) => <PopoverTaskRow key={task.taskId} task={task} projectId={projectId} nodeId={nodeId} />)}
        </ul>
      )}
    </div>
  );
}

function PopoverTaskRow({ task, projectId, nodeId }: { task: LinkedTask; projectId: string; nodeId: string }) {
  const presentation = getTaskTitlePresentation(task);
  return (
    <li data-testid={`task-link-popover-row-${task.taskId}`}>
      <a
        href={`?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(task.taskId)}&panelTab=files`}
        onClick={event => {
          if (!event.metaKey && !event.ctrlKey && !confirmFileNavigation(projectId)) { event.preventDefault(); return; }
          event.currentTarget.href = taskFilesHref(window.location.search, task.taskId, nodeId);
        }}
        className="flex min-h-11 items-center gap-2 px-3 py-2 hover:bg-zinc-50 focus-visible:outline-blue-500 dark:hover:bg-zinc-800"
      >
        <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", task.status === "done" ? "bg-emerald-500" : task.status === "in_progress" ? "bg-blue-500" : task.status === "blocked" ? "bg-red-500" : "bg-zinc-400")} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-xs font-medium text-zinc-800 dark:text-zinc-200", presentation.className)} aria-label={presentation.ariaLabel}>{task.title}</span>
          <span className="block text-[10px] capitalize text-zinc-500">{task.status.replace(/_/g, " ")}</span>
        </span>
      </a>
    </li>
  );
}

export default TaskLinkPopover;
