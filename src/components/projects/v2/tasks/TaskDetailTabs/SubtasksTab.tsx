"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, MoreHorizontal, Plus, Send, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TaskPanelSubtask } from "@/hooks/useTaskPanelResource";

type MutationResult = { success: boolean; error?: string };

interface SubtasksTabProps {
  subtasks: TaskPanelSubtask[];
  isLoading: boolean;
  error: string | null;
  canEdit: boolean;
  onAddSubtask: (title: string) => Promise<MutationResult>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<MutationResult>;
  onDeleteSubtask: (subtaskId: string) => Promise<MutationResult>;
  onUpdateSubtask: (subtaskId: string, title: string) => Promise<MutationResult>;
  onRetry: () => Promise<unknown>;
}

export default function SubtasksTab({
  subtasks,
  isLoading,
  error,
  canEdit,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUpdateSubtask,
  onRetry,
}: SubtasksTabProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const { openSubtasks, completedSubtasks, completedCount, completionPercent } = useMemo(() => {
    const completed = subtasks.filter((subtask) => subtask.completed);
    return {
      openSubtasks: subtasks.filter((subtask) => !subtask.completed),
      completedSubtasks: completed,
      completedCount: completed.length,
      completionPercent: subtasks.length ? Math.round((completed.length / subtasks.length) * 100) : 0,
    };
  }, [subtasks]);
  const displayError = localError || error;

  const setPending = (id: string, pending: boolean) => {
    setPendingIds((current) => {
      if (pending) return { ...current, [id]: true };
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const submitNewSubtask = async () => {
    const title = draft.trim();
    if (!title || isSubmitting) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      const result = await onAddSubtask(title);
      if (result.success) {
        setDraft("");
        setAnnouncement("Subtask added.");
      }
      else setLocalError(result.error || "Could not add subtask.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSubtask = async (subtask: TaskPanelSubtask) => {
    if (pendingIds[subtask.id]) return;
    setPending(subtask.id, true);
    setLocalError(null);
    try {
      const result = await onToggleSubtask(subtask.id, subtask.completed);
      if (result.success) setAnnouncement(`Subtask marked ${subtask.completed ? "incomplete" : "complete"}.`);
      else setLocalError(result.error || "Could not update subtask.");
    } finally {
      setPending(subtask.id, false);
    }
  };

  const saveTitle = async (subtask: TaskPanelSubtask) => {
    const title = editingDraft.trim();
    if (!title) {
      setLocalError("Subtask title is required.");
      return;
    }
    if (title === subtask.title || pendingIds[subtask.id]) {
      if (title === subtask.title) setEditingId(null);
      return;
    }
    setPending(subtask.id, true);
    setLocalError(null);
    try {
      const result = await onUpdateSubtask(subtask.id, title);
      if (result.success) {
        setEditingId(null);
        setAnnouncement("Subtask title updated.");
      }
      else setLocalError(result.error || "Could not rename subtask.");
    } finally {
      setPending(subtask.id, false);
    }
  };

  const deleteSubtask = async (subtask: TaskPanelSubtask) => {
    if (pendingIds[subtask.id]) return;
    setPending(subtask.id, true);
    setLocalError(null);
    try {
      const result = await onDeleteSubtask(subtask.id);
      if (!result.success) {
        setLocalError(result.error || "Could not delete subtask.");
      }
      if (result.success) setAnnouncement("Subtask deleted.");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Could not delete subtask.",
      );
    } finally {
      setPending(subtask.id, false);
    }
  };

  const startEditing = (subtask: TaskPanelSubtask) => {
    setEditingId(subtask.id);
    setEditingDraft(subtask.title);
  };

  const renderSubtask = (subtask: TaskPanelSubtask) => {
    const pending = pendingIds[subtask.id] === true;
    const editing = editingId === subtask.id;
    return (
      <li
        key={subtask.id}
        className={cn(
          "group flex min-h-12 items-center gap-3 border-b border-zinc-100 px-1 py-2.5 last:border-b-0 dark:border-zinc-800",
          subtask.completed && "text-zinc-500",
        )}
      >
        <button
          type="button"
          onClick={() => void toggleSubtask(subtask)}
          disabled={!canEdit || pending}
          role="checkbox"
          aria-checked={subtask.completed}
          aria-label={`${subtask.completed ? "Mark incomplete" : "Mark complete"}: ${subtask.title}`}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60",
            subtask.completed
              ? "border-primary bg-primary text-primary-foreground"
              : "border-zinc-300 text-zinc-400 hover:border-primary dark:border-zinc-700",
          )}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : subtask.completed ? <Check className="h-3 w-3" /> : null}
        </button>

        {editing ? (
          <input
            autoFocus
            value={editingDraft}
            onChange={(event) => setEditingDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveTitle(subtask);
              }
              if (event.key === "Escape") setEditingId(null);
            }}
            onBlur={() => void saveTitle(subtask)}
            disabled={pending}
            aria-label="Subtask title"
            className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm text-zinc-900 outline-none ring-1 ring-primary/50 dark:text-zinc-100"
          />
        ) : (
          <span className={cn("min-w-0 flex-1 break-words text-sm", subtask.completed ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-200")}>
            {subtask.title}
          </span>
        )}

        {pending ? <span className="shrink-0 text-xs text-zinc-400">Saving…</span> : null}
        {canEdit && !editing && !pending ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${subtask.title}`}
                className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[300]">
              <DropdownMenuItem onSelect={() => startEditing(subtask)}>Edit title</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void deleteSubtask(subtask)}>
                <Trash2 className="h-4 w-4" /> Delete subtask
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>
    );
  };

  return (
    <section className="flex min-h-full flex-col p-4 sm:p-5" aria-labelledby="subtasks-heading">
      <header className="border-b border-zinc-100 pb-4 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="subtasks-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Subtasks</h3>
            <p className="mt-1 text-xs text-zinc-500">{completedCount} of {subtasks.length} complete</p>
          </div>
          {subtasks.length > 0 ? <span className="text-xs font-semibold text-zinc-500">{completionPercent}%</span> : null}
        </div>
        {subtasks.length > 0 ? (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="progressbar"
            aria-label="Subtask completion"
            aria-valuemin={0}
            aria-valuemax={subtasks.length}
            aria-valuenow={completedCount}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${completionPercent}%` }} />
          </div>
        ) : null}
      </header>

      {displayError ? (
        <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          <span>{displayError}</span>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              void onRetry();
            }}
            className="shrink-0 font-semibold underline"
          >
            Retry
          </button>
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-12" role="status" aria-label="Loading subtasks">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : subtasks.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center py-12 text-center">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No subtasks yet</p>
          <p className="mt-1 text-sm text-zinc-500">Break this task into clear, verifiable steps.</p>
        </div>
      ) : (
        <div className="flex-1 py-4">
          {openSubtasks.length === 0 ? (
            <p className="mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">All subtasks complete.</p>
          ) : null}
          {openSubtasks.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Open · {openSubtasks.length}</p>
              <ul aria-label="Open subtasks">{openSubtasks.map(renderSubtask)}</ul>
            </div>
          ) : null}
          {completedSubtasks.length > 0 ? (
            <div className={cn(openSubtasks.length > 0 && "mt-5")}>
              <button
                type="button"
                onClick={() => setShowCompleted((current) => !current)}
                className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-200"
                aria-expanded={showCompleted}
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showCompleted && "-rotate-90")} />
                Completed · {completedSubtasks.length}
              </button>
              {showCompleted ? <ul aria-label="Completed subtasks">{completedSubtasks.map(renderSubtask)}</ul> : null}
            </div>
          ) : null}
        </div>
      )}

      {canEdit ? (
        <form
          className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-zinc-100 bg-white pt-3 dark:border-zinc-800 dark:bg-zinc-900"
          onSubmit={(event) => {
            event.preventDefault();
            void submitNewSubtask();
          }}
        >
          <Plus className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isSubmitting}
            placeholder="Add a subtask…"
            aria-label="Add a subtask"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={!draft.trim() || isSubmitting}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Add
          </button>
        </form>
      ) : null}
    </section>
  );
}
