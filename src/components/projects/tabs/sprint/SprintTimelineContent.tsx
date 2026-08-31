"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, ChevronDown, CheckCircle2, Circle, FolderUp, Flag, Link2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import {
  SPRINT_TASK_STATUS_PRESENTATION,
  type SprintTimelineRow,
  type SprintHealthSummary,
} from "@/lib/projects/sprint-detail";
import { sprintTimelinePersonName } from "@/lib/projects/sprint-presentation";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import { TASK_WORKING_FILES_TITLE } from "@/lib/files/task-working-files";
import { calculateTaskTimeHealth, getTaskTitlePresentation } from "@/lib/projects/task-presentation";
import { format, isSameYear } from "date-fns";

type Props = {
  projectSlug: string;
  projectKey?: string | null;
  sprintReference: string | null;
  sprint?: import("@/lib/projects/sprint-detail").SprintListItem | null;
  summary?: SprintHealthSummary | null;
  rows: SprintTimelineRow[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

export function SprintTimelineContent({
  projectSlug,
  projectKey,
  sprintReference,
  sprint,
  summary,
  rows,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: Props) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const toggleTask = (taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const tasks = rows
    .filter((r): r is Extract<SprintTimelineRow, { kind: "task" }> => r.kind === "task")
    .map((r) => r.task);
  const lifecycleRows = rows.filter((row) => row.kind !== "task");

  return (
    <div className="space-y-4">
      {summary ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Sprint summary">
          {[
            ["Progress", `${summary.completionPercentage}%`],
            ["Tasks", `${summary.completedTasks}/${summary.totalTasks}`],
            ["Blocked", String(summary.blockedTasks)],
            ["Files", String(summary.linkedFileCount)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {lifecycleRows.length > 0 ? (
        <ol className="flex flex-wrap gap-2" aria-label="Sprint lifecycle">
          {lifecycleRows.map((row) => (
            <li key={`${row.kind}:${row.id}`} className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800">
              <Flag aria-hidden="true" className="h-3 w-3" />
              {row.kind === "kickoff" ? "Sprint started" : "Sprint completed"}
              {row.occurredAt ? <time dateTime={row.occurredAt}>{format(new Date(row.occurredAt), "MMM d, yyyy")}</time> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">No tasks in this sprint yet.</p>
          <p className="mt-1 text-xs text-zinc-500">Assign tasks from the Task board to begin tracking this sprint.</p>
        </div>
      ) : (
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-sm">
        {tasks.map((task) => {
          const assignee = sprintTimelinePersonName(task.assignee, "Unassigned");
          const taskReference = task.taskNumber == null ? null : `${projectKey?.trim() || "Task"}-${task.taskNumber}`;

          const completedSubtasks = task.subtasks?.filter(st => st.completed).length ?? 0;
          const totalSubtasks = task.subtasks?.length ?? 0;

          const timeHealth = calculateTaskTimeHealth(
            {
              status: task.status,
              dueDate: task.dueDate,
              completedAt: task.completedAt,
              updatedAt: task.updatedAt,
            },
            sprint ? { status: sprint.status, endDate: sprint.endDate, completedAt: sprint.completedAt } : null
          );

          // ponytail: native linking, no complex "UI inside UI" accordion state
          const taskHref = `/projects/${encodeURIComponent(projectSlug)}?${new URLSearchParams({
            tab: "tasks",
            drawerType: "task",
            drawerId: taskReference ?? task.id,
            from: "sprint",
            ...(sprintReference ? { sprint: sprintReference } : {}),
          }).toString()}`;

          const status = SPRINT_TASK_STATUS_PRESENTATION[task.status];
          const titlePresentation = getTaskTitlePresentation(task);
          const isRemoved = task.isDeleted || task.membershipState === "historical";
          const isExpanded = expandedTaskId === task.id;

          return (
            <li key={task.id} className={cn("group flex flex-col transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50", isRemoved && "opacity-50 grayscale")}>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <div className="mt-1 flex shrink-0">
                    <UserAvatar identity={task.assignee} size={32} />
                  </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", status.toneClassName)}>
                      {status.label}
                    </span>
                    {timeHealth.state === "overdue" && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-900/50">
                        Overdue
                      </span>
                    )}
                    {timeHealth.state === "unfinished" && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/50">
                        Rolled Over
                      </span>
                    )}
                    {timeHealth.state === "overtime" && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-900/50">
                        Overtime
                      </span>
                    )}
                    <Link
                      href={taskHref}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "truncate text-sm font-semibold hover:underline",
                        titlePresentation.className,
                        titlePresentation.isCompleted && "hover:line-through",
                        (timeHealth.state === "overdue" || timeHealth.state === "unfinished")
                          ? "text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
                          : "text-zinc-900 hover:text-blue-600 dark:text-zinc-100 dark:hover:text-blue-400"
                      )}
                      aria-label={titlePresentation.ariaLabel}
                    >
                      {task.title}
                    </Link>
                    {isRemoved && <span className="text-xs font-medium text-zinc-500 border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 rounded-sm bg-zinc-100 dark:bg-zinc-900">Removed</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 font-medium">
                    {taskReference ? <span>{taskReference}</span> : null}
                    {taskReference ? <span>·</span> : null}
                    <span>{assignee}</span>
                    {task.storyPoints != null && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {task.storyPoints} PTS
                        </span>
                      </>
                    )}
                    {totalSubtasks > 0 && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {completedSubtasks}/{totalSubtasks}
                        </span>
                      </>
                    )}
                    {task.dueDate && (
                      <>
                        <span>·</span>
                        <span className={cn(
                          "inline-flex items-center gap-1",
                          (timeHealth.state === "overdue" || timeHealth.state === "unfinished" || timeHealth.state === "overtime")
                            ? "text-rose-600 dark:text-rose-400 font-semibold"
                            : ""
                        )}>
                          Due {format(new Date(task.dueDate), isSameYear(new Date(task.dueDate), new Date()) ? "MMM d" : "MMM d, yyyy")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 pl-4">
                <button
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`sprint-task-${task.id}`}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${task.title}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                >
                  <motion.div
                    initial={false}
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </motion.div>
                </button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  key="content"
                  id={`sprint-task-${task.id}`}
                  initial="collapsed"
                  animate="open"
                  exit="collapsed"
                  variants={{
                    open: { opacity: 1, height: "auto" },
                    collapsed: { opacity: 0, height: 0 }
                  }}
                  transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pl-[3.75rem] text-sm text-zinc-600 dark:text-zinc-300">
                    {task.description ? (
                      <div className="whitespace-pre-wrap">{task.description}</div>
                    ) : (
                      <p className="italic text-zinc-400">No description provided.</p>
                    )}
                    {/* Subtasks Section */}
                    {task.subtasks && task.subtasks.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">Subtasks</h4>
                        <ul className="space-y-1.5">
                          {task.subtasks.map((subtask) => (
                            <li key={subtask.id} className={cn("flex items-start gap-2 text-xs", subtask.completed && "opacity-50 line-through")}>
                              {subtask.completed ? (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                              ) : (
                                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                              )}
                              <span>{subtask.title}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Deliverables Section */}
                    {task.linkedFiles && task.linkedFiles.filter(f => f.role === "deliverable").length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Final Deliverables</h4>
                        <ul className="space-y-1.5">
                          {task.linkedFiles.filter(f => f.role === "deliverable").map((file) => (
                            <li key={file.nodeId} className="flex items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                              <FolderUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <Link href={`/projects/${encodeURIComponent(projectSlug)}?tab=files&fileId=${encodeURIComponent(file.nodeId)}`} className="truncate hover:underline">{file.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Task working files and references */}
                    {task.linkedFiles && task.linkedFiles.filter(f => f.role === "working").length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">{TASK_WORKING_FILES_TITLE}</h4>
                        <ul className="space-y-1.5">
                          {task.linkedFiles.filter(f => f.role === "working").map((file) => (
                            <li key={file.nodeId} className="flex items-center gap-2 text-xs">
                              <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                              <Link href={`/projects/${encodeURIComponent(projectSlug)}?tab=files&fileId=${encodeURIComponent(file.nodeId)}`} className="truncate text-zinc-600 hover:underline dark:text-zinc-400">{file.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {task.linkedFiles && task.linkedFiles.filter(f => f.role === "reference").length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">Task References</h4>
                        <ul className="space-y-1.5">
                          {task.linkedFiles.filter(f => f.role === "reference").map((file) => (
                            <li key={file.nodeId} className="flex items-center gap-2 text-xs">
                              <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                              <Link href={`/projects/${encodeURIComponent(projectSlug)}?tab=files&fileId=${encodeURIComponent(file.nodeId)}`} className="truncate text-zinc-600 hover:underline dark:text-zinc-400">{file.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/50">
                      <Link href={taskHref} className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
                        View full task details &rarr;
                      </Link>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
          );
        })}
      </ul>
      )}
      {hasMore && onLoadMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {isLoadingMore ? "Loading tasks…" : "Load more tasks"}
          </button>
        </div>
      ) : null}
      {sprint?.status === "completed" && summary && summary.completedTasks < summary.totalTasks ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          Sprint closed with {summary.totalTasks - summary.completedTasks} task{summary.totalTasks - summary.completedTasks === 1 ? "" : "s"} retained in its history.
        </p>
      ) : null}
    </div>
  );
}
