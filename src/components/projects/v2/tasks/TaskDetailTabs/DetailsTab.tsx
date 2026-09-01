"use client";

import React, { useCallback, useMemo, useRef } from "react";
import {
  Calendar,
  CheckSquare,
  Clock,
  ExternalLink,
  Flag,
  MessageSquareQuote,
  Paperclip,
  TriangleAlert,
  User,
  Zap,
  Lock,
  Check,
  X as XIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { readTaskSourceMessageLinksAction } from "@/app/actions/messaging/linked-work";
import { approveTaskReviewAction } from "@/app/actions/task";
import type { TaskFileReadinessWarning } from "@/lib/projects/task-file-intelligence";
import { normalizeTaskTitleDraft } from "@/lib/projects/task-file-intelligence";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/projects/sprint-detail";
import {
  getTaskTitlePresentation,
  isAssignableSprintOption,
  normalizeAssignableMembers,
  normalizeSprintOptions,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/projects/task-workflow";
import type { TaskPanelTab } from "@/hooks/useTaskPanelResource";
import { buildProjectPersonReference } from "@/lib/projects/settings-policies";
import { cn } from "@/lib/utils";

interface DetailsTabProps {
  task: TaskSurfaceRecord;
  canEdit: boolean;
  canManageSprint?: boolean;
  isMutating: boolean;
  mutationError: string | null;
  members?: any[];
  sprints?: any[];
  subtaskCount: number;
  completedSubtaskCount: number;
  attachmentCount: number;
  fileWarnings?: TaskFileReadinessWarning[];
  fileWarningSummary?: string | null;
  onUpdateField: (
    field: "title" | "description" | "priority" | "sprintId" | "dueDate",
    value: unknown,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateStatus: (
    status: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateAssignee: (
    assigneeId: string | null,
  ) => Promise<{ success: boolean; error?: string }>;
  onReviewApproved: (updatedAt: string) => void;
  onOpenTab: (tab: TaskPanelTab) => void;
}

export default function DetailsTab({
  task,
  canEdit,
  canManageSprint = false,
  isMutating,
  mutationError,
  members = [],
  sprints = [],
  subtaskCount,
  completedSubtaskCount,
  attachmentCount,
  fileWarnings = [],
  fileWarningSummary = null,
  onUpdateField,
  onUpdateStatus,
  onUpdateAssignee,
  onReviewApproved,
  onOpenTab,
}: DetailsTabProps) {
  const titlePresentation = getTaskTitlePresentation(task);
  const availableSprints = useMemo(
    () => normalizeSprintOptions(sprints),
    [sprints],
  );
  const availableMembers = useMemo(
    () => normalizeAssignableMembers(members),
    [members],
  );
  const availableMemberIds = useMemo(
    () => new Set(availableMembers.map((member) => member.id)),
    [availableMembers],
  );
  const currentAssigneeUnavailable = Boolean(
    task.assigneeId && !availableMemberIds.has(task.assigneeId),
  );
  const currentAssigneeReference = task.assignee
    ? buildProjectPersonReference({
        person: task.assignee,
        isActiveMember: !currentAssigneeUnavailable,
      })
    : null;
  const currentAssigneeLabel =
    currentAssigneeReference?.displayName ||
    task.assignee?.fullName ||
    "Removed collaborator";

  const createdAtLabel =
    task.createdAt && Number.isFinite(Date.parse(task.createdAt))
      ? format(new Date(task.createdAt), "MMM d, yyyy h:mm a")
      : "Unknown";
  const creatorName = task.creator?.fullName || "Unknown";
  const creatorAvatar = task.creator?.avatarUrl || null;
  const showDoneWarnings = task.status === "done" && fileWarnings.length > 0;
  const sourceLinksQuery = useQuery({
    queryKey: ["task-source-message-links", task.projectId, task.id],
    enabled: Boolean(task.projectId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!task.projectId) return [];
      const result = await readTaskSourceMessageLinksAction(
        task.projectId,
        task.id,
      );
      if (!result.success)
        throw new Error(result.error || "Failed to load source message");
      return result.links;
    },
  });
  const sourceLinks = sourceLinksQuery.data ?? [];

  const [isApproving, setIsApproving] = React.useState(false);
  const queryClient = useQueryClient();
  const [reviewError, setReviewError] = React.useState<string | null>(null);

  const handleApprove = async () => {
    if (!task.projectId) return;
    setReviewError(null);
    setIsApproving(true);
    try {
      const res = await approveTaskReviewAction(task.id, task.projectId);
      if (res.success && res.updatedAt) {
        onReviewApproved(res.updatedAt);
        void queryClient.invalidateQueries({ queryKey: ["files-task-collections", task.projectId] });
      }
      else setReviewError(res.error || "Failed to approve task review");
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = () => {
    onUpdateStatus("blocked");
  };

  return (
    <div className="grid min-h-full grid-cols-1 items-start gap-8 p-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-8 lg:col-span-2">
        {mutationError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
            {mutationError}
          </div>
        ) : null}

        {task.reviewStatus === "pending" ? (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="font-medium">In Review</div>
                <div className="text-xs text-indigo-700 dark:text-indigo-200">
                  The assignee has marked this as done. You can approve it to
                  finalize the task and publish its files, or reject it back to
                  the assignee.
                </div>
                {canManageSprint && (
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleApprove}
                      disabled={isApproving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {isApproving ? "Approving..." : "Done"}
                    </button>
                    <button
                      type="button"
                      onClick={handleReject}
                      disabled={isApproving}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-indigo-200 bg-white text-indigo-700 rounded-md text-xs font-semibold hover:bg-indigo-100 transition dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                      Issues
                    </button>
                  </div>
                )}
                {reviewError ? (
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    {reviewError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showDoneWarnings ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="space-y-2">
                <div className="font-medium">
                  {fileWarningSummary ||
                    "This task is done, but its file state still needs follow-up."}
                </div>
                <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-200">
                  {fileWarnings.map((warning) => (
                    <li key={warning.code} className="list-inside list-disc">
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <textarea
              key={`title-${task.id}`}
              defaultValue={task.title}
              ref={(el) => {
                if (el) {
                  el.style.height = "0px";
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
              onChange={(event) => {
                event.target.style.height = "0px";
                event.target.style.height = `${event.target.scrollHeight}px`;
              }}
              onBlur={(event) => {
                const normalized = normalizeTaskTitleDraft(event.target.value);
                if (!normalized) {
                  event.target.value = task.title; // revert on empty
                  return;
                }
                if (normalized !== task.title) {
                  void onUpdateField("title", normalized);
                }
              }}
              disabled={!canEdit || isMutating}
              rows={1}
              aria-label={titlePresentation.ariaLabel ?? "Task title"}
              className={cn(
                "w-full resize-none overflow-hidden bg-transparent text-2xl font-bold leading-tight text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100",
                titlePresentation.className,
                titlePresentation.isCompleted && "focus:no-underline focus:text-zinc-900 dark:focus:text-zinc-100",
              )}
              placeholder="Task title"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-800">
              <span className="text-zinc-400">Created by</span>
              <div className="flex items-center gap-1.5">
                <Avatar className="h-4 w-4">
                  <AvatarImage src={creatorAvatar ?? undefined} />
                  <AvatarFallback>
                    {creatorName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[140px] truncate font-medium text-zinc-900 dark:text-zinc-200">
                  {creatorName}
                </span>
              </div>
            </div>
            <span className="text-zinc-300 dark:text-zinc-700">•</span>
            <div className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-zinc-400" />
              <span>{createdAtLabel}</span>
            </div>
          </div>
        </div>

        {sourceLinksQuery.error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            {sourceLinksQuery.error instanceof Error
              ? sourceLinksQuery.error.message
              : "Failed to load source messages"}
          </div>
        ) : null}

        {sourceLinks.map((sourceLink, index) => (
          <div
            key={String(sourceLink.id ?? index)}
            className="rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100"
          >
            <div className="flex items-start gap-3">
              <MessageSquareQuote className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Created from message</div>
                <div className="mt-1 line-clamp-2 text-xs text-blue-700/80 dark:text-blue-200/80">
                  {String(
                    sourceLink.metadata?.sourcePreview ||
                      sourceLink.subtitle ||
                      "Open the original conversation context.",
                  )}
                </div>
              </div>
              {typeof sourceLink.metadata?.sourceMessageHref === "string" ? (
                <a
                  href={sourceLink.metadata.sourceMessageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-white dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100"
                >
                  Open source
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
        ))}

        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Description
          </label>
          <textarea
            key={`description-${task.id}`}
            rows={8}
            defaultValue={task.description || ""}
            onBlur={(event) => {
              if ((event.target.value || "") !== (task.description || "")) {
                void onUpdateField("description", event.target.value);
              }
            }}
            disabled={!canEdit || isMutating}
            placeholder="Add a description..."
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-indigo-500   disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onOpenTab("subtasks")}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <CheckSquare className="h-3.5 w-3.5" />
              Subtasks
            </span>
            <span className="mt-2 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {completedSubtaskCount}/{subtaskCount} complete
            </span>
          </button>
          <button
            type="button"
            onClick={() => onOpenTab("files")}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <Paperclip className="h-3.5 w-3.5" />
              Files
            </span>
            <span className="mt-2 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {attachmentCount} attached
            </span>
          </button>
        </div>
      </div>

      <div className="min-w-0 space-y-6">
        <div className="sticky top-6 space-y-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 pb-4 dark:border-zinc-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              Properties
            </h3>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase text-zinc-500">
              <Flag className="h-3 w-3" />
              Status
            </label>
            <select
              value={task.status}
              onChange={(event) => void onUpdateStatus(event.target.value)}
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500   disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              {TASK_WORKFLOW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getTaskStatusPresentation(status).label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-zinc-500">
              Priority
            </label>
            <select
              value={task.priority}
              onChange={(event) =>
                void onUpdateField("priority", event.target.value)
              }
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500   disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              {TASK_PRIORITY_VALUES.map((priority) => (
                <option key={priority} value={priority}>
                  {getTaskPriorityPresentation(priority).label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase text-zinc-500">
              <User className="h-3 w-3" />
              Assignee
            </label>
            <select
              value={task.assigneeId || ""}
              onChange={(event) =>
                void onUpdateAssignee(event.target.value || null)
              }
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500   disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              <option value="">Unassigned</option>
              {currentAssigneeUnavailable && task.assigneeId ? (
                <option value={task.assigneeId} disabled>
                  {currentAssigneeLabel} (removed from project)
                </option>
              ) : null}
              {availableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.identity?.fullName || "Unknown"}
                </option>
              ))}
            </select>
            {currentAssigneeUnavailable ? (
              <p className="text-xs text-amber-600 dark:text-amber-300">
                Removed from project · Needs reassignment
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase text-zinc-500">
              <Zap className="h-3 w-3" />
              Sprint
            </label>
            <select
              value={task.sprintId || ""}
              onChange={(event) =>
                void onUpdateField("sprintId", event.target.value || null)
              }
              disabled={!canEdit || !canManageSprint || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500   disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              <option value="">Backlog</option>
              {availableSprints.map((sprint) => (
                <option
                  key={sprint.id}
                  value={sprint.id}
                  disabled={!isAssignableSprintOption(sprint)}
                >
                  {sprint.name}
                  {isAssignableSprintOption(sprint)
                    ? ""
                    : ` · ${sprint.status ? SPRINT_STATUS_PRESENTATION[sprint.status].label : "Unavailable"}`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase text-zinc-500">
              <Calendar className="h-3 w-3" />
              Due date
            </label>
            <input
              type="date"
              value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
              onChange={(event) =>
                void onUpdateField("dueDate", event.target.value || null)
              }
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500   disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
