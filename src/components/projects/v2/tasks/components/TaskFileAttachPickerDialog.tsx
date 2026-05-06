"use client";

import { FileText, Folder, Link2, Loader2, Search, X } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { buildAttachCandidateHints } from "@/lib/projects/task-file-presentation";

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

const modifiedDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatModifiedDate(value?: Date | string | null) {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return modifiedDateFormatter.format(date);
}

export interface TaskFileAttachPickerDialogProps {
  open: boolean;
  query: string;
  loading: boolean;
  results: ProjectNode[];
  suggestions: ProjectNode[];
  attachments: (ProjectNode & { annotation?: string | null })[];
  canEdit: boolean;
  onQueryChange: (query: string) => void;
  onAttach: (node: ProjectNode) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
}

export function TaskFileAttachPickerDialog({
  open,
  query,
  loading,
  results,
  suggestions,
  attachments,
  canEdit,
  onQueryChange,
  onAttach,
  onOpenChange,
}: TaskFileAttachPickerDialogProps) {
  const renderHints = (node: ProjectNode, mode: "recent" | "search") => {
    const hints = buildAttachCandidateHints(node, attachments, mode);
    if (hints.length === 0) return null;
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {hints.map((hint) => (
          <span
            key={`${node.id}-${hint}`}
            className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {hint}
          </span>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[220] max-w-2xl overflow-hidden border-zinc-200 bg-white p-0 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-zinc-400" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Attach existing file or folder
            </div>
          </div>
          <button
            type="button"
            className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search project files/folders by name..."
              aria-label="Search project files and folders"
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-950"
            />
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </div>
            ) : !query && suggestions.length > 0 ? (
              <div className="space-y-1 p-2">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Recently updated files
                </div>
                {suggestions.map((node) => {
                  const alreadyAttached = attachments.some((attachment) => attachment.id === node.id);
                  return (
                    <div
                      key={node.id}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {node.type === "folder" ? (
                            <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
                          ) : (
                            <FileText className="h-4 w-4 flex-shrink-0 text-zinc-400" />
                          )}
                          {node.name}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {node.type === "folder"
                            ? "Folder"
                            : `${formatBytes(node.size)} • Modified ${formatModifiedDate(node.updatedAt)}`}
                        </div>
                        {node.path ? (
                          <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                            {node.path}
                          </div>
                        ) : null}
                        {renderHints(node, "recent")}
                      </div>
                      <button
                        type="button"
                        disabled={!canEdit || alreadyAttached}
                        onClick={() => void onAttach(node)}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                          canEdit && !alreadyAttached
                            ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            : "cursor-not-allowed border-transparent bg-zinc-100 text-zinc-400 dark:bg-zinc-800/50",
                        ].join(" ")}
                      >
                        {alreadyAttached ? "Attached" : "Attach"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : query && results.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500">
                No matches found for &quot;{query}&quot;
              </div>
            ) : query ? (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                <div className="bg-zinc-50 px-5 py-2 text-xs font-semibold text-zinc-500 dark:bg-zinc-900/50">
                  Search Results
                </div>
                {results.map((node) => {
                  const alreadyAttached = attachments.some((attachment) => attachment.id === node.id);
                  return (
                    <div key={node.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {node.type === "folder" ? (
                            <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
                          ) : (
                            <FileText className="h-4 w-4 flex-shrink-0 text-zinc-400" />
                          )}
                          {node.name}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {node.type === "folder" ? "Folder" : formatBytes(node.size)}
                        </div>
                        {node.path ? (
                          <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                            {node.path}
                          </div>
                        ) : null}
                        {renderHints(node, "search")}
                      </div>
                      <button
                        type="button"
                        disabled={!canEdit || alreadyAttached}
                        onClick={() => void onAttach(node)}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                          canEdit && !alreadyAttached
                            ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            : "cursor-not-allowed border-transparent bg-zinc-100 text-zinc-400 dark:bg-zinc-800/50",
                        ].join(" ")}
                      >
                        {alreadyAttached ? "Attached" : "Attach"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TaskFileAttachPickerDialog;
