"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import { Calendar, ChevronDown, Paperclip, Plus, Trash2, User, X, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";
import TaskAttachmentPicker from "./components/TaskAttachmentPicker";
import { buildTaskEditorDraft, taskEditorDraftSchema, type TaskEditorDraft, type TaskEditorSubtaskDraft } from "@/lib/projects/task-draft";
import { normalizeSprintOptions, normalizeTaskSurfacePerson } from "@/lib/projects/task-presentation";
import { TASK_PRIORITY_VALUES, TASK_WORKFLOW_STATUSES, getTaskPriorityPresentation, getTaskStatusPresentation } from "@/lib/projects/task-workflow";

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

type DraftField = keyof TaskEditorDraft;
type FieldErrors = Partial<Record<DraftField, string>>;

function toFieldErrors(error: z.ZodError<TaskEditorDraft>) {
    const nextErrors: FieldErrors = {};
    for (const issue of error.issues) {
        const path = issue.path[0];
        if (typeof path === "string" && !(path in nextErrors)) {
            nextErrors[path as DraftField] = issue.message;
        }
    }
    return nextErrors;
}

function inputClassName(hasError: boolean) {
    return cn(
        "w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:ring-2 focus:ring-blue-500/20 dark:bg-zinc-900 dark:text-zinc-100",
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
    const reduceMotion = useReducedMotionPreference();
    const availableSprints = React.useMemo(() => normalizeSprintOptions(sprints), [sprints]);
    const availableMembers = React.useMemo(
        () =>
            members
                .map((member) => {
                    const identity = normalizeTaskSurfacePerson(member?.user ?? member);
                    const id = member?.id ?? member?.userId ?? member?.user_id;
                    if (!id || !identity?.fullName) return null;
                    return {
                        id: String(id),
                        label: identity.fullName,
                    };
                })
                .filter(Boolean) as { id: string; label: string }[],
        [members],
    );

    const [draft, setDraft] = React.useState<TaskEditorDraft>(() => buildTaskEditorDraft());
    const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
    const [showAdvanced, setShowAdvanced] = React.useState(false);
    const [subtasks, setSubtasks] = React.useState<TaskEditorSubtaskDraft[]>([]);
    const [attachments, setAttachments] = React.useState<ProjectNode[]>([]);
    const [createAnother, setCreateAnother] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [isFilePickerOpen, setIsFilePickerOpen] = React.useState(false);

    React.useEffect(() => {
        if (!isOpen) return;
        setDraft(buildTaskEditorDraft());
        setFieldErrors({});
        setShowAdvanced(false);
        setSubtasks([]);
        setAttachments([]);
        setSubmitError(null);
        setIsSubmitting(false);
        setIsFilePickerOpen(false);
    }, [isOpen]);

    const handleFieldChange = React.useCallback((field: DraftField, value: string | null) => {
        setDraft((current) => ({ ...current, [field]: value ?? "" }) as TaskEditorDraft);
        setFieldErrors((current) => {
            if (!current[field]) return current;
            return {
                ...current,
                [field]: undefined,
            };
        });
    }, []);

    const handleAddSubtask = React.useCallback((value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        setSubtasks((current) => [...current, { id: crypto.randomUUID(), title: trimmed }]);
    }, []);

    const handleSubmit = React.useCallback(async () => {
        setSubmitError(null);
        const parsed = taskEditorDraftSchema.safeParse(draft);
        if (!parsed.success) {
            setFieldErrors(toFieldErrors(parsed.error));
            setSubmitError(parsed.error.issues[0]?.message ?? "Task details are invalid");
            return;
        }

        setIsSubmitting(true);
        try {
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
                return;
            }

            setDraft(buildTaskEditorDraft());
            setFieldErrors({});
            setSubtasks([]);
            setAttachments([]);
            setSubmitError(null);
        } catch (error) {
            console.error(error);
            setSubmitError("Failed to create task");
        } finally {
            setIsSubmitting(false);
        }
    }, [attachments, createAnother, draft, onClose, onCreate, subtasks]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0 } : undefined}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <motion.div
                initial={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0, y: 10 }}
                animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0, y: 10 }}
                transition={reduceMotion ? { duration: 0 } : undefined}
                className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
            >
                <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                    <div className="space-y-1">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Create Task</h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            Capture the task details without extra noise.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
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
                                value={draft.title}
                                onChange={(event) => handleFieldChange("title", event.target.value)}
                                placeholder="Task title"
                                className={cn(
                                    "w-full bg-transparent text-2xl font-semibold text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-600",
                                    fieldErrors.title ? "text-rose-700 dark:text-rose-300" : "",
                                )}
                                autoFocus
                            />
                            {fieldErrors.title ? (
                                <p className="text-xs text-rose-600 dark:text-rose-300">{fieldErrors.title}</p>
                            ) : null}
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Sprint</label>
                                <div className="relative">
                                    <select
                                        value={draft.sprintId ?? ""}
                                        onChange={(event) => handleFieldChange("sprintId", event.target.value || null)}
                                        className={cn(
                                            inputClassName(Boolean(fieldErrors.sprintId)),
                                            "appearance-none pl-10 pr-10",
                                        )}
                                    >
                                        <option value="">Backlog (no sprint)</option>
                                        {availableSprints.map((sprint) => (
                                            <option key={sprint.id} value={sprint.id}>
                                                {sprint.name}
                                            </option>
                                        ))}
                                    </select>
                                    <Zap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Assignee</label>
                                <div className="relative">
                                    <select
                                        value={draft.assigneeId ?? ""}
                                        onChange={(event) => handleFieldChange("assigneeId", event.target.value || null)}
                                        className={cn(
                                            inputClassName(Boolean(fieldErrors.assigneeId)),
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

                        <div className="flex flex-wrap gap-3">
                            <div className="relative">
                                <select
                                    value={draft.status}
                                    onChange={(event) => handleFieldChange("status", event.target.value)}
                                    className="appearance-none rounded-full border border-zinc-200 bg-zinc-100 py-1.5 pl-3 pr-8 text-xs font-medium text-zinc-700 outline-none transition hover:bg-zinc-200 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
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
                                    value={draft.priority}
                                    onChange={(event) => handleFieldChange("priority", event.target.value)}
                                    className="appearance-none rounded-full border border-zinc-200 bg-zinc-100 py-1.5 pl-3 pr-8 text-xs font-medium text-zinc-700 outline-none transition hover:bg-zinc-200 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                >
                                    {TASK_PRIORITY_VALUES.map((priority) => (
                                        <option key={priority} value={priority}>
                                            {getTaskPriorityPresentation(priority).label}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Description</label>
                            <textarea
                                value={draft.description}
                                onChange={(event) => handleFieldChange("description", event.target.value)}
                                placeholder="Add a short description..."
                                rows={4}
                                className={cn(inputClassName(Boolean(fieldErrors.description)), "resize-none px-4 py-3")}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Due Date</label>
                            <div className="relative">
                                <input
                                    type="date"
                                    value={draft.dueDate ?? ""}
                                    onChange={(event) => handleFieldChange("dueDate", event.target.value || null)}
                                    className={cn(inputClassName(Boolean(fieldErrors.dueDate)), "pl-10")}
                                />
                                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                            </div>
                            {fieldErrors.dueDate ? (
                                <p className="text-xs text-rose-600 dark:text-rose-300">{fieldErrors.dueDate}</p>
                            ) : null}
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowAdvanced((current) => !current)}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            {showAdvanced ? "Hide details" : "Add attachments or subtasks"}
                            <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvanced ? "rotate-180" : "")} />
                        </button>

                        <AnimatePresence initial={!reduceMotion}>
                            {showAdvanced ? (
                                <motion.div
                                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                                    transition={reduceMotion ? { duration: 0 } : undefined}
                                    className="space-y-5 overflow-hidden"
                                >
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Attachments</label>
                                        {attachments.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {attachments.map((attachment) => (
                                                    <div
                                                        key={attachment.id}
                                                        className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                                                    >
                                                        <Paperclip className="h-3.5 w-3.5 text-zinc-400" />
                                                        <span className="max-w-[180px] truncate">{attachment.name}</span>
                                                        <button
                                                            onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                                                            className="text-zinc-400 transition-colors hover:text-rose-500"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => setIsFilePickerOpen(true)}
                                            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400"
                                        >
                                            <Plus className="h-4 w-4" />
                                            Attach files from project
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Subtasks</label>
                                        <div className="space-y-2">
                                            {subtasks.map((subtask) => (
                                                <div
                                                    key={subtask.id}
                                                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/60"
                                                >
                                                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{subtask.title}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSubtasks((current) => current.filter((item) => item.id !== subtask.id))}
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
                                                className={inputClassName(false)}
                                            />
                                        </div>
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </div>
                </div>

                <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <input
                            type="checkbox"
                            checked={createAnother}
                            onChange={(event) => setCreateAnother(event.target.checked)}
                            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                        />
                        Create another
                    </label>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSubmitting ? "Creating..." : "Create Task"}
                        </button>
                    </div>
                </div>
            </motion.div>

            <TaskAttachmentPicker
                isOpen={isFilePickerOpen}
                onClose={() => setIsFilePickerOpen(false)}
                projectId={projectId}
                projectName={projectName}
                attachments={attachments}
                setAttachments={setAttachments}
            />
        </div>
    );
}
