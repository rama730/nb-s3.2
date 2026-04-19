"use client";

import React, { useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskPanelSubtask } from "@/hooks/useTaskPanelResource";

interface SubtasksTabProps {
  subtasks: TaskPanelSubtask[];
  isLoading: boolean;
  error: string | null;
  canEdit: boolean;
  onAddSubtask: (title: string) => Promise<{ success: boolean; error?: string }>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<{ success: boolean; error?: string }>;
  onDeleteSubtask: (subtaskId: string) => Promise<{ success: boolean; error?: string }>;
}

export default function SubtasksTab({
  subtasks,
  isLoading,
  error,
  canEdit,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
}: SubtasksTabProps) {
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingToggleIds, setPendingToggleIds] = useState<Record<string, boolean>>({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Record<string, boolean>>({});

  const completedCount = subtasks.filter((subtask) => subtask.completed).length;

  return (
    <div className="space-y-5 p-6">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Subtasks</h3>
          <p className="text-xs text-zinc-500">
            {completedCount}/{subtasks.length} completed
          </p>
        </div>
        {subtasks.length > 0 ? (
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${(completedCount / Math.max(1, subtasks.length)) * 100}%` }}
            />
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : subtasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No subtasks yet.
        </div>
      ) : (
        <div className="space-y-2">
          {subtasks.map((subtask) => {
            const isTogglePending = pendingToggleIds[subtask.id] === true;
            const isDeletePending = pendingDeleteIds[subtask.id] === true;

            return (
              <div
                key={subtask.id}
                className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <button
                  onClick={async () => {
                    setPendingToggleIds((current) => ({ ...current, [subtask.id]: true }));
                    await onToggleSubtask(subtask.id, subtask.completed);
                    setPendingToggleIds((current) => {
                      const next = { ...current };
                      delete next[subtask.id];
                      return next;
                    });
                  }}
                  disabled={!canEdit || isTogglePending}
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    subtask.completed
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-zinc-300 text-zinc-400 hover:border-indigo-500 dark:border-zinc-700",
                  )}
                >
                  {isTogglePending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : subtask.completed ? (
                    <Check className="h-3 w-3" />
                  ) : null}
                </button>

                <span
                  className={cn(
                    "flex-1 text-sm",
                    subtask.completed ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {subtask.title}
                </span>

                {canEdit ? (
                  <button
                    onClick={async () => {
                      setPendingDeleteIds((current) => ({ ...current, [subtask.id]: true }));
                      await onDeleteSubtask(subtask.id);
                      setPendingDeleteIds((current) => {
                        const next = { ...current };
                        delete next[subtask.id];
                        return next;
                      });
                    }}
                    disabled={isDeletePending}
                    className="text-zinc-400 opacity-0 transition-all hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60 group-hover:opacity-100"
                    aria-label="Delete subtask"
                  >
                    {isDeletePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <div className="flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Plus className="h-4 w-4 text-zinc-400" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={async (event) => {
              if (event.key !== "Enter" || !draft.trim()) return;
              event.preventDefault();
              setIsSubmitting(true);
              const result = await onAddSubtask(draft);
              if (result.success) {
                setDraft("");
              }
              setIsSubmitting(false);
            }}
            disabled={isSubmitting}
            placeholder="Add subtask... (Enter to add)"
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100"
          />
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : null}
        </div>
      ) : null}
    </div>
  );
}
