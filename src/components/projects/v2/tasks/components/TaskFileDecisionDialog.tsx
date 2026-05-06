"use client";

import type { ReactNode } from "react";

import { AlertCircle, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface TaskFileDecisionOption {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface TaskFileDecisionDialogProps {
  open: boolean;
  title: string;
  description: string;
  summary?: ReactNode;
  options: TaskFileDecisionOption[];
  error?: string | null;
  isSubmitting?: boolean;
  footerHint?: string | null;
  onSelect: (value: string) => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
}

export function TaskFileDecisionDialog({
  open,
  title,
  description,
  summary,
  options,
  error,
  isSubmitting = false,
  footerHint,
  onSelect,
  onOpenChange,
}: TaskFileDecisionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={Boolean(onOpenChange)}
        className="z-[230] max-w-xl border-zinc-200 bg-white p-0 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <DialogHeader className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <DialogTitle className="text-base text-zinc-900 dark:text-zinc-100">{title}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-zinc-500">{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {summary ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
              {summary}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={isSubmitting}
                onClick={() => void onSelect(option.value)}
                className={cn(
                  "flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  option.recommended
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500/70 dark:bg-indigo-500/10"
                    : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/70",
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {option.label}
                    {option.recommended ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-zinc-500">{option.description}</p>
                </div>
                {isSubmitting ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-zinc-400" /> : null}
              </button>
            ))}
          </div>

          {footerHint ? (
            <div className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {footerHint}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TaskFileDecisionDialog;
