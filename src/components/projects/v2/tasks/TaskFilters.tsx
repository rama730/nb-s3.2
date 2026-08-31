"use client";

import { cn } from "@/lib/utils";

interface TaskFiltersProps {
  scope: "all" | "backlog" | "sprint";
  setScope?: (scope: "all" | "backlog" | "sprint") => void;
}

const options = [
  { value: "all", label: "All tasks" },
  { value: "sprint", label: "Sprint" },
  { value: "backlog", label: "Backlog" },
] as const;

export default function TaskFilters({ scope, setScope }: TaskFiltersProps) {
  return (
    <div
      className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900"
      aria-label="Task scope"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={scope === option.value}
          onClick={() => setScope?.(option.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            scope === option.value
              ? "app-selected-surface text-primary"
              : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
