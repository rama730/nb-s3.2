"use client";

import * as React from "react";
import { X } from "lucide-react";

export interface FileInspectorPanelHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
  closeTestId?: string;
}

export function FileInspectorPanelHeader({
  title,
  subtitle,
  icon,
  onClose,
  closeLabel,
  closeTestId,
}: FileInspectorPanelHeaderProps): React.JSX.Element {
  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="flex shrink-0 items-start justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {icon}
          <span>{title}</span>
        </h3>
        {subtitle ? (
          <div className="mt-0.5 min-w-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {subtitle}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        data-testid={closeTestId}
        className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none   dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

