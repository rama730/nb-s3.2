// Task 5.3 — `LinkedTasksPanel` component.
//
// A collapsible right-side drawer on FileView that lists all tasks linked
// to the currently viewed file. Shows title, status, assignee, and annotation
// for each linked task.
//
// Requirements covered:
//   - Req 8.1: Toggle button opens/closes the panel as a collapsible drawer
//   - Req 8.2: Lists all linked tasks with title, status, assignee, annotation
//   - Req 8.3: Click task row → open task panel with initialTab="files"
//   - Req 8.4: Role_Owner/Role_Member: inline annotation editor via updateAnnotation
//   - Req 8.5: Role_Viewer: read-only, no annotation editor or mutation affordances
//   - Req 8.6: Toggle button visible to all roles
//   - Req 17.1: performance.mark on first interactive state
//   - Req 24.3: No annotation editor or link/unlink affordances for Role_Viewer

"use client";

import * as React from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTaskLinks, type LinkedTask } from "@/hooks/useTaskLinks";
import { FileInspectorPanelHeader } from "./FileInspectorPanelHeader";

// ─── Props ───────────────────────────────────────────────────────────

export interface LinkedTasksPanelProps {
  projectId: string;
  nodeId: string;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function LinkedTasksPanel({
  projectId,
  nodeId,
  canEdit,
  onOpenTask,
  onClose,
}: LinkedTasksPanelProps): React.JSX.Element {
  const { tasks, isLoading, error, updateAnnotation } = useTaskLinks(
    projectId,
    nodeId,
  );

  // ── Performance mark (Req 17.1) ────────────────────────────────────
  const perfMarkedRef = React.useRef(false);
  React.useEffect(() => {
    if (isLoading) return;
    if (perfMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:linked-tasks-panel-interactive");
    perfMarkedRef.current = true;
  }, [isLoading]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      data-testid="linked-tasks-panel"
      className={cn(
        "flex h-full w-72 shrink-0 flex-col border-l border-zinc-200 bg-white",
        "dark:border-zinc-800 dark:bg-zinc-950",
      )}
    >
      <FileInspectorPanelHeader
        title="Linked Tasks"
        onClose={onClose}
        closeLabel="Close linked tasks"
        closeTestId="files-tab-linked-tasks-close"
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-red-500">
            {error}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No tasks linked to this file.
          </div>
        ) : (
          <ul role="list" className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tasks.map((task) => (
              <LinkedTaskRow
                key={task.taskId}
                task={task}
                canEdit={canEdit}
                onOpenTask={onOpenTask}
                onUpdateAnnotation={updateAnnotation}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── LinkedTaskRow ───────────────────────────────────────────────────

interface LinkedTaskRowProps {
  task: LinkedTask;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onUpdateAnnotation: (
    taskId: string,
    annotation: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

function LinkedTaskRow({
  task,
  canEdit,
  onOpenTask,
  onUpdateAnnotation,
}: LinkedTaskRowProps): React.JSX.Element {
  const [isEditing, setIsEditing] = React.useState(false);
  const [annotationDraft, setAnnotationDraft] = React.useState(
    task.annotation ?? "",
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const handleSaveAnnotation = React.useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    await onUpdateAnnotation(task.taskId, annotationDraft.trim());
    setIsSaving(false);
    setIsEditing(false);
  }, [task.taskId, annotationDraft, onUpdateAnnotation, isSaving]);

  const handleCancelEdit = React.useCallback(() => {
    setAnnotationDraft(task.annotation ?? "");
    setIsEditing(false);
  }, [task.annotation]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveAnnotation();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleSaveAnnotation, handleCancelEdit],
  );

  return (
    <li
      data-testid={`linked-task-row-${task.taskId}`}
      className="group"
    >
      {/* Clickable task row */}
      <button
        type="button"
        onClick={() => onOpenTask(task.taskId)}
        className={cn(
          "w-full text-left px-3 py-2.5 transition-colors",
          "hover:bg-zinc-50 dark:hover:bg-zinc-900",
        )}
        data-testid={`linked-task-row-open-${task.taskId}`}
      >
        <div className="flex items-start gap-2">
          <StatusDot status={task.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {task.title}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="capitalize">
                {task.status.replace(/_/g, " ")}
              </span>
              {task.assigneeName && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">•</span>
                  <span className="truncate">{task.assigneeName}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Annotation section */}
      <div className="px-3 pb-2">
        {isEditing && canEdit ? (
          /* Inline annotation editor (Req 8.4) */
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={annotationDraft}
              onChange={(e) => setAnnotationDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add annotation…"
              aria-label="Edit annotation"
              data-testid={`linked-task-annotation-input-${task.taskId}`}
              className={cn(
                "h-6 flex-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 text-xs outline-none",
                "focus:border-indigo-400  ",
                "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
              )}
              disabled={isSaving}
            />
            <button
              type="button"
              onClick={handleSaveAnnotation}
              disabled={isSaving}
              aria-label="Save annotation"
              data-testid={`linked-task-annotation-save-${task.taskId}`}
              className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              aria-label="Cancel editing"
              data-testid={`linked-task-annotation-cancel-${task.taskId}`}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : task.annotation ? (
          /* Display annotation (read-only for Role_Viewer, editable for others) */
          <div className="flex items-center gap-1">
            <span
              className="flex-1 truncate text-xs italic text-zinc-500 dark:text-zinc-400"
              data-testid={`linked-task-annotation-${task.taskId}`}
            >
              {task.annotation}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setAnnotationDraft(task.annotation ?? "");
                  setIsEditing(true);
                }}
                aria-label="Edit annotation"
                data-testid={`linked-task-annotation-edit-${task.taskId}`}
                className="rounded p-0.5 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : canEdit ? (
          /* No annotation yet — show "Add annotation" button for editors */
          <button
            type="button"
            onClick={() => {
              setAnnotationDraft("");
              setIsEditing(true);
            }}
            data-testid={`linked-task-annotation-add-${task.taskId}`}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            + Add annotation
          </button>
        ) : null}
      </div>
    </li>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }): React.JSX.Element {
  const colorClass = React.useMemo(() => {
    switch (status) {
      case "done":
        return "bg-emerald-500";
      case "in_progress":
        return "bg-blue-500";
      case "blocked":
        return "bg-red-500";
      default:
        return "bg-zinc-400";
    }
  }, [status]);

  return (
    <span
      className={cn(
        "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
        colorClass,
      )}
      aria-hidden="true"
    />
  );
}

export default LinkedTasksPanel;
