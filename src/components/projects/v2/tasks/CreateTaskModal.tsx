"use client";

import React from "react";
import {
  Calendar,
  ChevronDown,
  Paperclip,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiAttachmentPicker } from "../files-tab/picker/MultiAttachmentPicker";
import {
  taskEditorDraftSchema,
  type TaskEditorDraft,
  type TaskEditorSubtaskDraft,
} from "@/lib/projects/task-draft";
import {
  isAssignableSprintOption,
  normalizeAssignableMembers,
  normalizeSprintOptions,
} from "@/lib/projects/task-presentation";
import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/projects/task-workflow";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    draft: TaskEditorDraft;
    subtasks: TaskEditorSubtaskDraft[];
    attachments: ProjectNode[];
  }) => Promise<{ success: boolean; error?: string }>;
  members?: any[];
  sprints?: any[];
  projectId: string;
  projectName?: string;
}

function inputClassName(hasError: boolean) {
  return cn(
    "w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition   dark:bg-zinc-900 dark:text-zinc-100",
    hasError
      ? "border-rose-300 focus:border-rose-400 dark:border-rose-800 dark:focus:border-rose-700"
      : "border-zinc-200 focus:border-blue-500 dark:border-zinc-700 dark:focus:border-blue-500",
  );
}

export default function CreateTaskModal({
  isOpen,
  onClose,
  onCreate,
  members = [],
  sprints = [],
  projectId,
  projectName,
}: CreateTaskModalProps) {
  const availableSprints = React.useMemo(
    () => normalizeSprintOptions(sprints),
    [sprints],
  );
  const availableMembers = React.useMemo(
    () => normalizeAssignableMembers(members),
    [members],
  );

  const [subtasks, setSubtasks] = React.useState<TaskEditorSubtaskDraft[]>([]);
  const [attachments, setAttachments] = React.useState<ProjectNode[]>([]);
  const [createAnother, setCreateAnother] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    setSubtasks([]);
    setAttachments([]);
    setSubmitError(null);
    setIsSubmitting(false);
    setIsFilePickerOpen(false);
  }, [isOpen]);

  const handleAddSubtask = React.useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubtasks((current) => [
      ...current,
      { id: crypto.randomUUID(), title: trimmed },
    ]);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);

    try {
      const draft: TaskEditorDraft = {
        title: formData.get("title") as string,
        sprintId: (formData.get("sprintId") as string) || null,
        assigneeId: (formData.get("assigneeId") as string) || null,
        priority:
          (formData.get("priority") as "low" | "medium" | "high" | "urgent") ||
          "medium",
        status: (formData.get("status") as TaskEditorDraft["status"]) || "todo",
        description: (formData.get("description") as string) || "",
        dueDate: (formData.get("dueDate") as string) || null,
      };

      const parsed = taskEditorDraftSchema.safeParse(draft);
      if (!parsed.success) {
        setSubmitError(
          parsed.error.issues[0]?.message || "Task details are invalid",
        );
        return;
      }

      const result = await onCreate({
        draft: parsed.data,
        subtasks,
        attachments,
      });
      if (!result.success) {
        setSubmitError(result.error || "Failed to create task");
        return;
      }

      if (!createAnother) {
        onClose();
      } else {
        e.currentTarget.reset();
        setSubtasks([]);
        setAttachments([]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[200] bg-black/60 backdrop-blur-sm"
          className="z-[201] flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border-zinc-200 p-0 dark:border-zinc-700"
        >
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 w-full flex-col"
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Create Task
                </DialogTitle>
                <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
                  Capture the task details without extra noise.
                </DialogDescription>
              </DialogHeader>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close create task dialog"
                className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {submitError ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {submitError}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <input
                    name="title"
                    required
                    defaultValue=""
                    placeholder="Task title"
                    className="w-full bg-transparent text-2xl font-semibold text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Sprint
                    </label>
                    <div className="relative">
                      <select
                        name="sprintId"
                        defaultValue=""
                        className={cn(
                          inputClassName(false),
                          "appearance-none pl-10 pr-10",
                        )}
                      >
                        <option value="">Backlog (no sprint)</option>
                        {availableSprints.map((sprint) => {
                          const isAssignable = isAssignableSprintOption(sprint);
                          return (
                            <option
                              key={sprint.id}
                              value={sprint.id}
                              disabled={!isAssignable}
                            >
                              {sprint.name}
                              {isAssignable ? "" : " (Completed)"}
                            </option>
                          );
                        })}
                      </select>
                      <Zap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Assignee
                    </label>
                    <div className="relative">
                      <select
                        name="assigneeId"
                        defaultValue=""
                        className={cn(
                          inputClassName(false),
                          "appearance-none pl-10 pr-10",
                        )}
                      >
                        <option value="">Unassigned</option>
                        {availableMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.label}
                          </option>
                        ))}
                      </select>
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <select
                      name="status"
                      defaultValue="todo"
                      className="appearance-none rounded-full border border-zinc-200 bg-zinc-100 py-1.5 pl-3 pr-8 text-xs font-medium text-zinc-700 outline-none transition hover:bg-zinc-200   dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      {TASK_WORKFLOW_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {getTaskStatusPresentation(status).label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                  </div>

                  <div className="relative">
                    <select
                      name="priority"
                      defaultValue="medium"
                      className="appearance-none rounded-full border border-zinc-200 bg-zinc-100 py-1.5 pl-3 pr-8 text-xs font-medium text-zinc-700 outline-none transition hover:bg-zinc-200   dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      {TASK_PRIORITY_VALUES.map((priority) => (
                        <option key={priority} value={priority}>
                          {getTaskPriorityPresentation(priority).label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsFilePickerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-zinc-300 bg-transparent py-1.5 px-3 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    <Paperclip className="h-3 w-3" />
                    Add task references
                  </button>
                </div>

                {attachments.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                      >
                        <Paperclip className="h-3.5 w-3.5 text-zinc-400" />
                        <span className="max-w-[180px] truncate">
                          {attachment.name}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${attachment.name}`}
                          onClick={() =>
                            setAttachments((current) =>
                              current.filter(
                                (item) => item.id !== attachment.id,
                              ),
                            )
                          }
                          className="text-zinc-400 transition-colors hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Description
                  </label>
                  <textarea
                    name="description"
                    defaultValue=""
                    placeholder="Add a short description..."
                    rows={4}
                    className={cn(
                      "w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition dark:bg-zinc-900 dark:text-zinc-100",
                      "border-zinc-200 focus:border-zinc-300 dark:border-zinc-700 dark:focus:border-zinc-600",
                      "resize-none px-4 py-3 focus:ring-0",
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Subtasks
                  </label>
                  <div className="space-y-2">
                    {subtasks.map((subtask) => (
                      <div
                        key={subtask.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/60"
                      >
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {subtask.title}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove subtask ${subtask.title}`}
                          onClick={() =>
                            setSubtasks((current) =>
                              current.filter((item) => item.id !== subtask.id),
                            )
                          }
                          className="text-zinc-400 transition-colors hover:text-rose-500"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <input
                      placeholder="Add subtask... (Enter to add)"
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        handleAddSubtask(event.currentTarget.value);
                        event.currentTarget.value = "";
                      }}
                      className={cn(
                        "w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition dark:bg-zinc-900 dark:text-zinc-100",
                        "border-zinc-200 focus:border-zinc-300 dark:border-zinc-700 dark:focus:border-zinc-600",
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Due Date
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      name="dueDate"
                      defaultValue=""
                      className={cn(inputClassName(false), "pl-10")}
                    />
                    <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={createAnother}
                  onChange={(event) => setCreateAnother(event.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 "
                />
                Create another
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Creating..." : "Create Task"}
                </button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <MultiAttachmentPicker
        isOpen={isFilePickerOpen}
        onClose={() => setIsFilePickerOpen(false)}
        projectId={projectId}
        projectName={projectName}
        initialAttachments={attachments}
        onConfirm={setAttachments}
      />
    </>
  );
}
