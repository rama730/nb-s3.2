"use client";

import React, { createContext, useContext, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type Transfer = {
  id: string;
  label: string;
  total: number;
  completed: number;
  failed: number;
  status: "running" | "done" | "error";
  error?: string;
  retry?: () => void;
};
const TransfersContext = createContext<{
  active: number;
  open: () => void;
  start: (label: string, total: number) => string;
  update: (id: string, patch: Partial<Omit<Transfer, "id">>) => void;
} | null>(null);
export const useFileTransfers = () => useContext(TransfersContext);

/** An on-demand view of the existing upload pipeline, not a second job queue. */
export function FileTransfersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<Transfer[]>([]);
  const [open, setOpen] = useState(false);
  const start = useCallback((label: string, total: number) => {
    const id = crypto.randomUUID();
    setJobs((current) => [
      { id, label, total, completed: 0, failed: 0, status: "running" },
      ...current.filter((job) => job.status === "running"),
      ...current.filter((job) => job.status !== "running").slice(0, 19),
    ]);
    return id;
  }, []);
  const update = useCallback(
    (id: string, patch: Partial<Omit<Transfer, "id">>) => {
      setJobs((current) =>
        current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
      );
    },
    [],
  );
  const active = jobs.filter((job) => job.status === "running").length;
  React.useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  return (
    <TransfersContext.Provider
      value={{ active, start, update, open: () => setOpen(true) }}
    >
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogTitle>Transfers</DialogTitle>
          <DialogDescription>
            Uploads in this Files session. Keep this page open while uploads are
            running. Failed items can be retried without re-uploading successful
            items.
          </DialogDescription>
          {!jobs.length && (
            <p className="py-6 text-sm text-zinc-500">
              No transfers in this session.
            </p>
          )}
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {jobs.map((job) => (
              <li key={job.id} className="space-y-2 py-3 text-sm">
                <p className="break-words font-medium">{job.label}</p>
                <progress
                  className="h-2 w-full"
                  value={job.completed}
                  max={Math.max(1, job.total)}
                  aria-label={`Upload progress: ${job.label}`}
                />
                <p role="status">
                  {job.status === "running"
                    ? "Uploading"
                    : job.status === "error"
                      ? "Needs attention"
                      : "Complete"}{" "}
                  · {job.completed} of {job.total}
                  {job.failed ? ` · ${job.failed} failed` : ""}
                </p>
                {job.error && (
                  <p className="break-words text-red-600 dark:text-red-400">
                    {job.error}
                  </p>
                )}
                {job.status !== "running" && (
                  <div className="flex gap-2">
                    {job.retry && (
                      <button
                        type="button"
                        className="min-h-11 rounded border px-3"
                        onClick={() => {
                          update(job.id, { retry: undefined });
                          job.retry?.();
                        }}
                      >
                        Retry failed items
                      </button>
                    )}
                    <button
                      type="button"
                      className="min-h-11 rounded px-3 text-zinc-500"
                      onClick={() =>
                        setJobs((current) =>
                          current.filter((item) => item.id !== job.id),
                        )
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </TransfersContext.Provider>
  );
}
