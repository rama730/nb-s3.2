"use client";

import { ShieldAlert } from "lucide-react";

import type { TaskFileReadinessWarning } from "@/lib/projects/task-file-intelligence";
import { summarizeTaskFileWarningNextStep } from "@/lib/projects/task-file-presentation";

export interface TaskFilesWarningBannerProps {
  warnings: TaskFileReadinessWarning[];
  summary: string | null;
  showDetails: boolean;
  onToggleDetails: () => void;
}

export function TaskFilesWarningBanner({
  warnings,
  summary,
  showDetails,
  onToggleDetails,
}: TaskFilesWarningBannerProps) {
  if (warnings.length === 0) return null;

  const nextStep = summarizeTaskFileWarningNextStep(warnings);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="font-medium">
              {summary || "This task’s files still need a quick follow-up."}
            </div>
            {warnings.length > 1 ? (
              <button
                type="button"
                onClick={onToggleDetails}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                {showDetails ? "Hide checklist" : "Open checklist"}
              </button>
            ) : null}
          </div>
          <div className="text-xs font-medium text-amber-700 dark:text-amber-200">
            Next step: {nextStep}
          </div>
          {showDetails || warnings.length === 1 ? (
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-200">
              {warnings.map((warning) => (
                <li key={warning.code} className="list-inside list-disc">
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-amber-700 dark:text-amber-200">
              {warnings.length} checks still need attention.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TaskFilesWarningBanner;
