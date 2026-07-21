import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type SecurityListRowProps = {
  icon?: LucideIcon;
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  details?: ReactNode;
  summary?: ReactNode;
  action?: ReactNode;
};

export function SecurityListRow({ icon: Icon, title, badges, meta, details, summary, action }: SecurityListRowProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? <span className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800"><Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" /></span> : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}{badges}</div>
          {details ? <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">{details}</div> : null}
          {summary ? <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{summary}</div> : null}
        </div>
      </div>
      {meta || action ? <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">{meta}{action}</div> : null}
    </div>
  );
}
