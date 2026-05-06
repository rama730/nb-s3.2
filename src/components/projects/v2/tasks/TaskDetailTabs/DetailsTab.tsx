"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Check, CheckSquare, Clock, ExternalLink, Flag, MessageSquareQuote, Paperclip, TriangleAlert, User, Zap } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { readTaskSourceMessageLinksAction } from "@/app/actions/messaging/linked-work";
import type { ProjectNode } from "@/lib/db/schema";
import type { TaskFileReadinessWarning } from "@/lib/projects/task-file-intelligence";
import { normalizeTaskTitleDraft } from "@/lib/projects/task-file-intelligence";
import {
  normalizeSprintOptions,
  normalizeTaskSurfacePerson,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/projects/task-workflow";
import { cn } from "@/lib/utils";
import type { TaskPanelSubtask } from "@/hooks/useTaskPanelResource";

interface DetailsTabProps {
  task: TaskSurfaceRecord;
  canEdit: boolean;
  isMutating: boolean;
  mutationError: string | null;
  members?: any[];
  sprints?: any[];
  subtasks: TaskPanelSubtask[];
  attachments: ProjectNode[];
  fileWarnings?: TaskFileReadinessWarning[];
  fileWarningSummary?: string | null;
  onUpdateField: (
    field: "title" | "description" | "priority" | "sprintId" | "dueDate",
    value: unknown,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateStatus: (status: string) => Promise<{ success: boolean; error?: string }>;
  onUpdateAssignee: (assigneeId: string | null) => Promise<{ success: boolean; error?: string }>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<{ success: boolean; error?: string }>;
  onDownloadAttachment: (node: ProjectNode) => Promise<void> | void;
}

function autosizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${element.scrollHeight}px`;
}

export default function DetailsTab({
  task,
  canEdit,
  isMutating,
  mutationError,
  members = [],
  sprints = [],
  subtasks,
  attachments,
  fileWarnings = [],
  fileWarningSummary = null,
  onUpdateField,
  onUpdateStatus,
  onUpdateAssignee,
  onToggleSubtask,
  onDownloadAttachment,
}: DetailsTabProps) {
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description || "");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleSaveInFlightRef = useRef(false);

  useEffect(() => {
    setDescriptionDraft(task.description || "");
  }, [task.description]);

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(task.title);
      setTitleError(null);
    }
  }, [isEditingTitle, task.title]);

  useEffect(() => {
    if (!isEditingTitle) return;
    autosizeTextarea(titleTextareaRef.current);
  }, [isEditingTitle, titleDraft]);

  const availableSprints = useMemo(() => normalizeSprintOptions(sprints), [sprints]);
  const availableMembers = useMemo(
    () =>
      members
        .map((member) => {
          const identity = normalizeTaskSurfacePerson(member?.user ?? member);
          const id = member?.user_id || member?.id || identity?.id;
          if (!id) return null;
          return { id: String(id), identity };
        })
        .filter(Boolean) as { id: string; identity: ReturnType<typeof normalizeTaskSurfacePerson> }[],
    [members],
  );

  const createdAtLabel =
    task.createdAt && Number.isFinite(Date.parse(task.createdAt))
      ? format(new Date(task.createdAt), "MMM d, yyyy h:mm a")
      : "Unknown";
  const creatorName = task.creator?.fullName || "Unknown";
  const creatorAvatar = task.creator?.avatarUrl || null;
  const completedSubtasks = subtasks.filter((subtask) => subtask.completed).length;
  const showDoneWarnings = task.status === "done" && fileWarnings.length > 0;
  const sourceLinksQuery = useQuery({
    queryKey: ["task-source-message-links", task.projectId, task.id],
    enabled: Boolean(task.projectId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!task.projectId) return [];
      const result = await readTaskSourceMessageLinksAction(task.projectId, task.id);
      if (!result.success) throw new Error(result.error || "Failed to load source message");
      return result.links;
    },
  });
  const sourceLinks = sourceLinksQuery.data ?? [];

  const enterTitleEditMode = useCallback(() => {
    if (!canEdit) return;
    setTitleError(null);
    setIsEditingTitle(true);
    requestAnimationFrame(() => {
      if (!titleTextareaRef.current) return;
      autosizeTextarea(titleTextareaRef.current);
      titleTextareaRef.current.focus();
      const end = titleTextareaRef.current.value.length;
      titleTextareaRef.current.setSelectionRange(end, end);
    });
  }, [canEdit]);

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(task.title);
    setTitleError(null);
    setIsEditingTitle(false);
  }, [task.title]);

  const saveTitleDraft = useCallback(async () => {
    if (titleSaveInFlightRef.current) {
      return { success: false as const, error: "Title update already in progress." };
    }

    const normalizedTitle = normalizeTaskTitleDraft(titleDraft);
    if (!normalizedTitle) {
      setTitleError("Task title is required.");
      requestAnimationFrame(() => titleTextareaRef.current?.focus());
      return { success: false as const, error: "Task title is required." };
    }

    setTitleDraft(normalizedTitle);
    setTitleError(null);

    if (normalizedTitle === task.title) {
      setIsEditingTitle(false);
      return { success: true as const };
    }

    titleSaveInFlightRef.current = true;
    try {
      const result = await onUpdateField("title", normalizedTitle);
      if (result.success) {
        setIsEditingTitle(false);
      } else if (result.error) {
        setTitleError(result.error);
        requestAnimationFrame(() => titleTextareaRef.current?.focus());
      }
      return result;
    } finally {
      titleSaveInFlightRef.current = false;
    }
  }, [onUpdateField, task.title, titleDraft]);

  return (
    <div className="grid min-h-full grid-cols-1 items-start gap-8 p-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-8 lg:col-span-2">
        {mutationError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
            {mutationError}
          </div>
        ) : null}

        {showDoneWarnings ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="space-y-2">
                <div className="font-medium">
                  {fileWarningSummary || "This task is done, but its file state still needs follow-up."}
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
          {isEditingTitle ? (
            <div className="space-y-2">
              <textarea
                ref={titleTextareaRef}
                value={titleDraft}
                onChange={(event) => {
                  setTitleDraft(event.target.value);
                  if (titleError) setTitleError(null);
                }}
                onBlur={() => {
                  void saveTitleDraft();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitleEdit();
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void saveTitleDraft();
                  }
                }}
                disabled={!canEdit || isMutating}
                rows={1}
                aria-label="Task title"
                className="w-full resize-none overflow-hidden bg-transparent text-2xl font-bold leading-tight text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100"
                placeholder="Task title"
              />
              {titleError ? <p className="text-xs text-rose-500">{titleError}</p> : null}
            </div>
          ) : canEdit ? (
            <button
              type="button"
              onClick={enterTitleEditMode}
              className="w-full rounded-lg text-left outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              aria-label="Edit task title"
            >
              <h1 className="whitespace-pre-wrap break-words text-2xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">
                {task.title}
              </h1>
            </button>
          ) : (
            <h1 className="whitespace-pre-wrap break-words text-2xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">
              {task.title}
            </h1>
          )}

	          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-800">
              <span className="text-zinc-400">Created by</span>
              <div className="flex items-center gap-1.5">
                <Avatar className="h-4 w-4">
                  <AvatarImage src={creatorAvatar ?? undefined} />
                  <AvatarFallback>{creatorName.slice(0, 2).toUpperCase()}</AvatarFallback>
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

        {sourceLinks.length > 0 ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
            <div className="flex items-start gap-3">
              <MessageSquareQuote className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Created from message</div>
                <div className="mt-1 line-clamp-2 text-xs text-blue-700/80 dark:text-blue-200/80">
                  {String(sourceLinks[0]?.metadata?.sourcePreview || sourceLinks[0]?.subtitle || "Open the original conversation context.")}
                </div>
              </div>
              {typeof sourceLinks[0]?.metadata?.sourceMessageHref === "string" ? (
                <a
                  href={sourceLinks[0].metadata.sourceMessageHref}
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
        ) : null}

	        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Description</label>
          <textarea
            rows={8}
            value={descriptionDraft}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            onBlur={() => {
              if ((descriptionDraft || "") !== (task.description || "")) {
                void onUpdateField("description", descriptionDraft);
              }
            }}
            disabled={!canEdit || isMutating}
            placeholder="Add a description..."
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        {attachments.length > 0 ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <Paperclip className="h-3.5 w-3.5" />
              Attachments ({attachments.length})
            </label>
            <div className="flex flex-wrap gap-3">
              {attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  onClick={() => void onDownloadAttachment(attachment)}
                  className="group relative flex h-24 w-28 flex-col items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 transition-all hover:border-indigo-500 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <Paperclip className="mb-2 h-6 w-6 text-zinc-400 transition-colors group-hover:text-indigo-500" />
                  <span className="w-full truncate px-2 text-center text-[10px] text-zinc-600 dark:text-zinc-400">
                    {attachment.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <CheckSquare className="h-3.5 w-3.5" />
              Subtasks ({completedSubtasks}/{subtasks.length})
            </label>
            {subtasks.length > 0 ? (
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${(completedSubtasks / Math.max(1, subtasks.length)) * 100}%` }}
                />
              </div>
            ) : null}
          </div>

          {subtasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No subtasks yet. Use the Subtasks tab to add them.
            </div>
          ) : (
            <div className="space-y-2">
              {subtasks.map((subtask) => (
                <div
                  key={subtask.id}
                  className="group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <button
                    onClick={() => void onToggleSubtask(subtask.id, subtask.completed)}
                    disabled={!canEdit}
                    className={cn(
                      "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors",
                      subtask.completed
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-zinc-300 text-zinc-400 hover:border-indigo-500 dark:border-zinc-700",
                      !canEdit && "cursor-not-allowed opacity-50",
                    )}
                  >
                    {subtask.completed ? <Check className="h-3 w-3" /> : null}
                  </button>
                  <span
                    className={cn(
                      "text-sm leading-tight",
                      subtask.completed ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    {subtask.title}
                  </span>
                </div>
              ))}
            </div>
          )}
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
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              {TASK_WORKFLOW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getTaskStatusPresentation(status).label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-zinc-500">Priority</label>
            <select
              value={task.priority}
              onChange={(event) => void onUpdateField("priority", event.target.value)}
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
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
              onChange={(event) => void onUpdateAssignee(event.target.value || null)}
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              <option value="">Unassigned</option>
              {availableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.identity?.fullName || "Unknown"}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase text-zinc-500">
              <Zap className="h-3 w-3" />
              Sprint
            </label>
            <select
              value={task.sprintId || ""}
              onChange={(event) => void onUpdateField("sprintId", event.target.value || null)}
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            >
              <option value="">Backlog</option>
              {availableSprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
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
              onChange={(event) => void onUpdateField("dueDate", event.target.value || null)}
              disabled={!canEdit || isMutating}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
