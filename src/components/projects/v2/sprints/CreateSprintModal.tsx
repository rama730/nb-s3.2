"use client";

import React from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarDays, Trash2, X } from "lucide-react";
import { z } from "zod";

import type { SprintListItem } from "@/lib/projects/sprint-detail";
import {
  buildSprintEditorDraft,
  createSprintDraftSchema,
  getSprintDurationSummary,
  type CreateSprintDraftInput,
  type SprintDeleteImpact,
  type SprintEditorDraft,
  type SprintEditorMode,
} from "@/lib/projects/sprints";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import { cn } from "@/lib/utils";

type SprintEditorSubmitResult = {
  success: boolean;
  error?: string;
};

interface SprintEditorModalProps {
  projectId: string;
  isOpen: boolean;
  mode: SprintEditorMode;
  onClose: () => void;
  onSubmit: (data: CreateSprintDraftInput) => Promise<SprintEditorSubmitResult>;
  onDelete?: () => Promise<SprintEditorSubmitResult>;
  sprint?: SprintListItem | null;
  sprintCount?: number;
  deleteImpact?: SprintDeleteImpact | null;
}

type DraftField = keyof SprintEditorDraft;
type FieldErrors = Partial<Record<DraftField, string>>;
type PendingAction = "save" | "delete" | null;

function toFieldErrors(error: z.ZodError<CreateSprintDraftInput>) {
  const nextErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path === "string" && !(path in nextErrors)) {
      nextErrors[path as DraftField] = issue.message;
    }
  }
  return nextErrors;
}

function Section({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border px-4 py-4",
        tone === "danger"
          ? "border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/15"
          : "border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-800/30",
      )}
    >
      <div className="mb-4 space-y-1">
        <h4
          className={cn(
            "text-sm font-semibold",
            tone === "danger" ? "text-rose-700 dark:text-rose-300" : "text-zinc-900 dark:text-zinc-100",
          )}
        >
          {title}
        </h4>
        {description ? <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required ? " *" : ""}
      </label>
      {children}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}

function inputClassName(hasError: boolean) {
  return cn(
    "w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:ring-2 focus:ring-blue-500/20 dark:bg-zinc-900 dark:text-zinc-100",
    hasError
      ? "border-rose-300 focus:border-rose-400 dark:border-rose-800 dark:focus:border-rose-700"
      : "border-zinc-200 focus:border-blue-500 dark:border-zinc-700 dark:focus:border-blue-500",
  );
}

export default function SprintEditorModal({
  projectId,
  isOpen,
  mode,
  onClose,
  onSubmit,
  onDelete,
  sprint = null,
  sprintCount = 0,
  deleteImpact = null,
}: SprintEditorModalProps) {
  const [draft, setDraft] = React.useState<SprintEditorDraft>(() =>
    buildSprintEditorDraft({ sprint, sprintCount }),
  );
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = React.useState("");
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    setDraft(buildSprintEditorDraft({ sprint, sprintCount }));
    setFieldErrors({});
    setErrorMessage("");
    setPendingAction(null);
    setConfirmDelete(false);
  }, [isOpen, sprint, sprintCount]);

  const scheduleSummary = React.useMemo(
    () => getSprintDurationSummary(draft.startDate, draft.endDate),
    [draft.endDate, draft.startDate],
  );

  const handleFieldChange = React.useCallback((field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      return {
        ...current,
        [field]: undefined,
      };
    });
  }, []);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage("");

      const parsed = createSprintDraftSchema.safeParse(draft);
      if (!parsed.success) {
        setFieldErrors(toFieldErrors(parsed.error));
        setErrorMessage(parsed.error.issues[0]?.message ?? "Sprint details are invalid");
        recordSprintMetric("project.sprint.editor.validation", {
          projectId,
          sprintId: sprint?.id ?? null,
          mode,
          field: parsed.error.issues[0]?.path[0] ?? "unknown",
          issueCount: parsed.error.issues.length,
        });
        return;
      }

      setPendingAction("save");
      try {
        const result = await onSubmit(parsed.data);
        if (!result.success) {
          setErrorMessage(result.error ?? "Failed to save sprint");
          return;
        }
        onClose();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to save sprint");
      } finally {
        setPendingAction(null);
      }
    },
    [draft, mode, onClose, onSubmit, projectId, sprint?.id],
  );

  const handleDelete = React.useCallback(async () => {
    if (!onDelete || !deleteImpact?.canDelete) return;
    setErrorMessage("");
    setPendingAction("delete");
    try {
      const result = await onDelete();
      if (!result.success) {
        setErrorMessage(result.error ?? "Failed to delete sprint");
        return;
      }
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete sprint");
    } finally {
      setPendingAction(null);
    }
  }, [deleteImpact?.canDelete, onClose, onDelete]);

  const setDuration = React.useCallback((days: number) => {
    if (!draft.startDate) return;
    const endDate = new Date(`${draft.startDate}T00:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + days);
    const year = endDate.getUTCFullYear();
    const month = String(endDate.getUTCMonth() + 1).padStart(2, "0");
    const date = String(endDate.getUTCDate()).padStart(2, "0");
    handleFieldChange("endDate", `${year}-${month}-${date}`);
  }, [draft.startDate, handleFieldChange]);

  if (!isOpen) return null;

  const isSubmitting = pendingAction === "save";
  const isDeleting = pendingAction === "delete";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={pendingAction ? undefined : onClose}
      />

      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {mode === "create" ? "Create Sprint" : "Edit Sprint"}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {mode === "create"
                ? "Define the sprint goal and schedule without extra noise."
                : "Adjust the sprint details and manage it from one place."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!pendingAction}
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300"
              >
                {errorMessage}
              </div>
            ) : null}

            <Section title="Basics" description="Keep the sprint definition tight and easy to scan.">
              <div className="space-y-4">
                <Field label="Sprint Name" htmlFor="sprint-name" required error={fieldErrors.name}>
                  <input
                    id="sprint-name"
                    required
                    value={draft.name}
                    onChange={(event) => handleFieldChange("name", event.target.value)}
                    placeholder="e.g., Sprint 4"
                    className={inputClassName(!!fieldErrors.name)}
                  />
                </Field>

                <Field label="Sprint Goal" htmlFor="sprint-goal" error={fieldErrors.goal}>
                  <input
                    id="sprint-goal"
                    value={draft.goal}
                    onChange={(event) => handleFieldChange("goal", event.target.value)}
                    placeholder="What should this sprint accomplish?"
                    className={inputClassName(!!fieldErrors.goal)}
                  />
                </Field>

                <Field label="Description" htmlFor="sprint-description" error={fieldErrors.description}>
                  <textarea
                    id="sprint-description"
                    rows={3}
                    value={draft.description}
                    onChange={(event) => handleFieldChange("description", event.target.value)}
                    placeholder="Additional context, scope, or coordination notes."
                    className={cn(inputClassName(!!fieldErrors.description), "resize-none")}
                  />
                </Field>
              </div>
            </Section>

            <Section title="Schedule" description="Set the sprint window and keep the duration intentional.">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                    Quick set
                  </span>
                  <button
                    type="button"
                    onClick={() => setDuration(7)}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                  >
                    1 week
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration(14)}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                  >
                    2 weeks
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration(28)}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                  >
                    4 weeks
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Start Date" htmlFor="sprint-start-date" required error={fieldErrors.startDate}>
                    <input
                      id="sprint-start-date"
                      type="date"
                      required
                      value={draft.startDate}
                      onChange={(event) => handleFieldChange("startDate", event.target.value)}
                      className={inputClassName(!!fieldErrors.startDate)}
                    />
                  </Field>

                  <Field label="End Date" htmlFor="sprint-end-date" required error={fieldErrors.endDate}>
                    <input
                      id="sprint-end-date"
                      type="date"
                      required
                      min={draft.startDate}
                      value={draft.endDate}
                      onChange={(event) => handleFieldChange("endDate", event.target.value)}
                      className={inputClassName(!!fieldErrors.endDate)}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950/80">
                  <CalendarDays className="h-4 w-4 text-zinc-400" />
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">
                    {scheduleSummary?.label ?? "Set valid start and end dates to see the sprint duration."}
                  </span>
                  {sprint?.status === "active" ? (
                    <span className="text-xs text-amber-600 dark:text-amber-300">
                      This sprint is active. Complete it from the header before deleting it.
                    </span>
                  ) : null}
                </div>
              </div>
            </Section>

            {mode === "edit" ? (
              <Section
                title="Danger zone"
                description="Deleting a sprint keeps the tasks but removes their sprint assignment."
                tone="danger"
              >
                <div className="space-y-4">
                  <div className="rounded-xl border border-rose-200/80 bg-white px-4 py-3 dark:border-rose-900/50 dark:bg-zinc-950">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {deleteImpact?.affectedTaskCount ?? 0} work item{deleteImpact?.affectedTaskCount === 1 ? "" : "s"} will be unassigned
                        </p>
                        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                          Tasks and files stay in the project. Only the sprint record and sprint assignment are removed.
                        </p>
                      </div>
                      <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        {sprint?.status ?? "planning"}
                      </span>
                    </div>
                  </div>

                  {!deleteImpact?.canDelete ? (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p>{deleteImpact?.reason ?? "This sprint cannot be deleted right now."}</p>
                    </div>
                  ) : confirmDelete ? (
                    <div className="space-y-3 rounded-xl border border-rose-200 bg-white px-4 py-4 dark:border-rose-900/50 dark:bg-zinc-950">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Delete {deleteImpact.sprintName}?
                      </p>
                      <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                        This cannot be undone. The sprint will be removed and the affected work items will return to an unsprinted state.
                      </p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={!!pendingAction}
                          onClick={() => setConfirmDelete(false)}
                          className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                        >
                          Keep sprint
                        </button>
                        <button
                          type="button"
                          disabled={!!pendingAction}
                          onClick={() => void handleDelete()}
                          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          {isDeleting ? "Deleting..." : "Delete sprint"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!!pendingAction}
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete sprint
                    </button>
                  )}
                </div>
              </Section>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                disabled={!!pendingAction}
                onClick={onClose}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!!pendingAction}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? "Saving..." : mode === "create" ? "Create Sprint" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
