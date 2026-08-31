"use client";

import React, { memo } from "react";
import {
  Calendar,
  CheckSquare,
  Lock,
  MessageSquare,
  Paperclip,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/projects/sprint-detail";
import {
  calculateTaskTimeHealth,
  getTaskTitlePresentation,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import TaskStatusBadge from "./badges/TaskStatusBadge";
import { formatTaskId } from "@/lib/project-key";

interface TaskCardProps {
  task: TaskSurfaceRecord | any;
  onClick?: (task: TaskSurfaceRecord) => void;
  activeAssignableMemberIds?: Set<string>;
}

export type Task = TaskSurfaceRecord;

type TaskMetaIndicatorProps = {
  title: string;
  icon: typeof CheckSquare;
  label: string | number;
  unreadCount?: number;
};

function TaskMetaIndicator({
  title,
  icon: Icon,
  label,
  unreadCount = 0,
}: TaskMetaIndicatorProps) {
  const hasUnread = unreadCount > 0;

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded border border-zinc-100 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium dark:border-zinc-800 dark:bg-zinc-800/50"
      title={title}
      aria-label={
        hasUnread
          ? `${title}, ${label}, ${unreadCount} new`
          : `${title}, ${label}`
      }
    >
      <Icon
        className={cn(
          "h-3 w-3 transition-all duration-300",
          hasUnread ? "text-rose-500 dark:text-rose-400 drop-shadow-[0_0_3px_rgba(244,63,94,0.3)]" : "text-zinc-400"
        )}
      />
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
}

function TaskMetaIndicators({
  subtaskCount,
  completedSubtaskCount,
  newSubtaskCount,
  fileCount,
  newFileCount,
  commentCount,
  newCommentCount,
}: Pick<
  TaskSurfaceRecord,
  | "subtaskCount"
  | "completedSubtaskCount"
  | "newSubtaskCount"
  | "fileCount"
  | "newFileCount"
  | "commentCount"
  | "newCommentCount"
>) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-zinc-400 dark:text-zinc-500"
      aria-label={`Task activity summary: ${completedSubtaskCount ?? 0} of ${subtaskCount ?? 0} subtasks complete, ${fileCount ?? 0} attachments, ${commentCount ?? 0} comments`}
    >
      {(subtaskCount ?? 0) > 0 && (
        <TaskMetaIndicator
          title="Subtasks"
          icon={CheckSquare}
          label={`${completedSubtaskCount ?? 0}/${subtaskCount}`}
          unreadCount={newSubtaskCount}
        />
      )}
      {((fileCount ?? 0) > 0 || (newFileCount ?? 0) > 0) && (
        <TaskMetaIndicator
          title="Attachments"
          icon={Paperclip}
          label={Math.max(fileCount ?? 0, newFileCount ?? 0)}
          unreadCount={newFileCount}
        />
      )}
      {(commentCount ?? 0) > 0 && (
        <TaskMetaIndicator
          title="Comments"
          icon={MessageSquare}
          label={commentCount ?? 0}
          unreadCount={newCommentCount}
        />
      )}
    </div>
  );
}

export const TaskCard = memo(function TaskCard({
  task,
  onClick,
  activeAssignableMemberIds,
}: TaskCardProps) {
  const taskRecord = normalizeTaskSurfaceRecord(task);
  const titlePresentation = getTaskTitlePresentation(taskRecord);
  const assigneeRemoved = Boolean(
    taskRecord.assigneeId &&
    taskRecord.assignee &&
    activeAssignableMemberIds &&
    !activeAssignableMemberIds.has(taskRecord.assigneeId),
  );
  const timeHealth = calculateTaskTimeHealth(
    taskRecord,
    taskRecord.sprint ?? null,
  );
  const dueDate = taskRecord.dueDate ? parseISO(taskRecord.dueDate) : null;
  const hasValidDueDate = Boolean(dueDate && !Number.isNaN(dueDate.getTime()));

  return (
    <button
      type="button"
      data-testid="task-card"
      onClick={() => onClick?.(taskRecord)}
      className={cn(
        "group relative h-[128px] w-full min-w-0 cursor-pointer overflow-hidden rounded-xl bg-white transition-colors duration-200 dark:bg-zinc-900",
        "ring-1 ring-inset ring-zinc-900/5 dark:ring-white/10",
        "hover:ring-zinc-900/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:ring-white/20",
      )}
    >
      <div className="grid h-full grid-rows-[20px_24px_28px] content-between p-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4
            className={cn(
              "min-w-0 truncate text-left text-sm font-semibold leading-5 tracking-tight text-zinc-900 dark:text-zinc-100",
              titlePresentation.className,
            )}
            title={taskRecord.title}
            aria-label={titlePresentation.ariaLabel}
          >
            {taskRecord.title}
          </h4>
        </div>

        {/* Keep the card compact: stable status first, then semantic labels without a horizontal scroller. */}
        <div className="flex h-6 min-w-0 items-center gap-1.5 overflow-hidden">
          <TaskStatusBadge status={taskRecord.status} className="shrink-0 px-1.5 text-[10px] font-bold" />
          <div className="shrink-0">
            <TaskPriorityBadge priority={taskRecord.priority} />
          </div>
          {taskRecord.reviewStatus === "pending" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-200">
              <Lock className="h-3 w-3" />
              In Review
            </span>
          )}
          {timeHealth.state === "overdue" && (
            <span className="shrink-0 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-900/50">
              Overdue
            </span>
          )}
          {timeHealth.state === "unfinished" && (
            <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-500 dark:ring-amber-900/50">
              Rolled over
            </span>
          )}
          {timeHealth.state === "overtime" && (
            <span className="shrink-0 rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-900/50">
              Overtime
            </span>
          )}
          {assigneeRemoved && (
            <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              Needs reassignment
            </span>
          )}
          {taskRecord.sprint?.name && (
            <span
              className={cn(
                "max-w-[112px] shrink-0 truncate rounded-md border px-2 py-0.5 text-[10px] font-bold",
                taskRecord.sprint.status
                  ? SPRINT_STATUS_PRESENTATION[taskRecord.sprint.status]
                      .toneClassName
                  : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800",
              )}
              title={taskRecord.sprint.name}
            >
              {taskRecord.sprint.name}
            </span>
          )}
          {taskRecord.storyPoints != null && (
            <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800">
              {taskRecord.storyPoints} pts
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800/60">
          {/* ponytail: avatar + task counts share one fixed footer row; names belong in the tooltip. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {taskRecord.assignee ? (
              <div
                className="shrink-0"
                title={
                  assigneeRemoved
                    ? `${taskRecord.assignee.fullName} was removed from the project`
                    : taskRecord.assignee.fullName ?? undefined
                }
              >
                <UserAvatar
                  identity={{
                    fullName: taskRecord.assignee.fullName,
                    avatarUrl: taskRecord.assignee.avatarUrl,
                  }}
                  size={20}
                  className="h-5 w-5"
                  fallbackClassName="text-[9px]"
                />
              </div>
            ) : (
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
                title="Unassigned"
              >
                <User className="h-3 w-3 text-zinc-400" />
              </div>
            )}
            <TaskMetaIndicators {...taskRecord} />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {hasValidDueDate && taskRecord.status !== "done" && (
              <div
                className={cn(
                  "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                  timeHealth.state === "overdue" ||
                    timeHealth.state === "overtime"
                    ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/30"
                    : "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/30",
                )}
              >
                <Calendar className="h-3 w-3" />
                {format(dueDate!, "MMM d")}
              </div>
            )}
            <span className="whitespace-nowrap text-[10px] font-mono font-medium text-zinc-400 transition-colors group-hover:text-zinc-500">
              {taskRecord.taskNumber && taskRecord.projectKey
                ? formatTaskId(taskRecord.projectKey, taskRecord.taskNumber)
                : "Task"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
});
