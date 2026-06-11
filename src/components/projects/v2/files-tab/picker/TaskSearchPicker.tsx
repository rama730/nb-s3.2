// Task 3.4 — `TaskSearchPicker` for the Files tab v3 (task-files-version-control).
//
// A project-scoped task search dialog that lists tasks the user can link to.
// Opened from the "Attach to task…" action in `FileActionsBar` (Task 5.5).
//
// Requirements covered:
//   - Req 9.3: Open a project-scoped task picker dialog listing tasks
//   - Req 9.4: User selects a task → `onSelect(taskId)` fires

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X, CheckSquare } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatTaskId } from "@/lib/project-key";

// ─── Constants ───────────────────────────────────────────────────────

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 30;

interface SearchableTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  taskNumber: number | null;
  projectKey: string | null;
  assigneeName: string | null;
}

// ─── Props ───────────────────────────────────────────────────────────

export interface TaskSearchPickerProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (taskId: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function TaskSearchPicker({
  projectId,
  isOpen,
  onClose,
  onSelect,
}: TaskSearchPickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchableTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // ── Debounce query ─────────────────────────────────────────────────
  useEffect(() => {
    if (query.length === 0) {
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // ── Fetch tasks ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoading(true);

    import("@/app/actions/files/links")
      .then(({ searchProjectTasks }) =>
        searchProjectTasks(projectId, debouncedQuery, MAX_RESULTS),
      )
      .then((tasks) => {
        if (!cancelled) {
          setResults(tasks);
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedQuery, isOpen]);

  // ── Reset state on open/close ──────────────────────────────────────
  useEffect(() => {
    let timer: number | undefined;
    if (isOpen) {
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setActiveIndex(0);
      // Focus input after dialog animation
      timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isOpen]);

  // ── Scroll active item into view ──────────────────────────────────
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // ── Selection handler ──────────────────────────────────────────────
  const handleSelect = useCallback(
    (taskId: string) => {
      onSelect(taskId);
    },
    [onSelect],
  );

  // ── Keyboard navigation ────────────────────────────────────────────
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const task = results[activeIndex];
        if (task) handleSelect(task.id);
      }
    },
    [onClose, results, activeIndex, handleSelect],
  );

  const showEmpty = !isLoading && results.length === 0 && debouncedQuery.length > 0;
  const showRecent = !isLoading && results.length > 0 && debouncedQuery.length === 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="z-[220] max-w-lg overflow-hidden border-zinc-200 bg-white p-0 dark:border-zinc-800 dark:bg-zinc-900"
        showCloseButton={false}
        data-testid="task-search-picker"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Select a task</DialogTitle>
          <DialogDescription>Search and select a task to link to this file</DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <Search className="h-4 w-4 flex-shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks by title..."
            aria-label="Search tasks"
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400 text-zinc-900 dark:text-zinc-100"
            role="combobox"
            aria-expanded="true"
            aria-controls="task-search-picker-listbox"
            aria-activedescendant={
              results[activeIndex]
                ? `task-search-picker-item-${results[activeIndex].id}`
                : undefined
            }
          />
          <button
            type="button"
            className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>

        {/* Results list */}
        <div
          id="task-search-picker-listbox"
          className="max-h-[50vh] overflow-y-auto"
          role="listbox"
        >
          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching tasks...
            </div>
          ) : showEmpty ? (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No tasks found for &quot;{debouncedQuery}&quot;
            </div>
          ) : results.length === 0 && !isLoading ? (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No tasks in this project
            </div>
          ) : (
            <>
              {showRecent && (
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Recent tasks
                </div>
              )}
              {debouncedQuery.length > 0 && results.length > 0 && (
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Search results
                </div>
              )}
              {results.map((task, idx) => {
                const isActive = idx === activeIndex;
                const taskLabel = task.taskNumber && task.projectKey
                  ? formatTaskId(task.projectKey, task.taskNumber)
                  : null;

                return (
                  <button
                    key={task.id}
                    id={`task-search-picker-item-${task.id}`}
                    role="option"
                    aria-selected={isActive}
                    type="button"
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    className={
                      "w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors " +
                      (isActive
                        ? "bg-zinc-50 dark:bg-zinc-800"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50")
                    }
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(task.id)}
                    data-testid={`task-search-picker-item-${task.id}`}
                  >
                    <CheckSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {task.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        {taskLabel && (
                          <span className="font-mono">{taskLabel}</span>
                        )}
                        <StatusDot status={task.status} />
                        <span className="capitalize">{task.status.replace("_", " ")}</span>
                        {task.assigneeName && (
                          <>
                            <span className="text-zinc-300 dark:text-zinc-600">•</span>
                            <span className="truncate">{task.assigneeName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colorClass = useMemo(() => {
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

  return <span className={`inline-block h-2 w-2 rounded-full ${colorClass}`} />;
}

export default TaskSearchPicker;
