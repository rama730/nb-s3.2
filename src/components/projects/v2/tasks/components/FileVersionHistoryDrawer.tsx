"use client";

/**
 * Version-history side drawer for a single file node.
 *
 * Lists every row in `file_versions` for a node (capped at 200 by the
 * server action), with affordances to:
 *   • Download a specific historical blob via a short-lived signed URL.
 *   • Restore a historical version — writes a NEW row (never rewrites),
 *     pointing the node back at the old `s3Key`. Old blobs are retained,
 *     so the operation is reversible.
 *
 * We deliberately do not stream via the Supabase storage client here —
 * the server action mints a fresh signed URL each time so row-level
 * security stays on the server side.
 *
 * The drawer is controlled (open/onOpenChange) so the parent tab can
 * coordinate it with the Files list. Uses the same Dialog primitive as
 * the rest of the app for consistent focus-trap / ESC behaviour.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  History,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui-custom/Toast";
import { cn } from "@/lib/utils";
import type { FileVersion, ProjectNode } from "@/lib/db/schema";
import {
  getVersionSignedUrl,
  listFileVersions,
  restoreFileVersion,
} from "@/app/actions/files/versions";

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export interface FileVersionHistoryDrawerProps {
  projectId: string;
  node: ProjectNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Viewer may restore? Hides the Restore button when false. */
  canEdit: boolean;
  /**
   * Optional uploader display names keyed by user id. If absent, we fall
   * back to rendering a short hash of the uploader id.
   */
  uploaderNames?: Record<string, string>;
  /** Called after a successful restore so the parent can refresh the row. */
  onRestored?: (version: FileVersion) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; versions: FileVersion[] }
  | { kind: "error"; message: string };

export function FileVersionHistoryDrawer({
  projectId,
  node,
  open,
  onOpenChange,
  canEdit,
  uploaderNames,
  onRestored,
}: FileVersionHistoryDrawerProps) {
  const { showToast } = useToast();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const rows = await listFileVersions(projectId, node.id);
      setState({ kind: "loaded", versions: rows });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load versions";
      setState({ kind: "error", message });
    }
  }, [node.id, projectId]);

  // Load once when the drawer opens; reset to idle when it closes so we
  // don't hold stale data while the parent mutates the node.
  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setState({ kind: "idle" });
      setPendingAction(null);
    }
  }, [open, refresh]);

  const currentVersion = useMemo(() => {
    if (state.kind !== "loaded") return null;
    return state.versions[0]?.version ?? node.currentVersion ?? 1;
  }, [state, node.currentVersion]);

  const handleDownload = useCallback(
    async (version: FileVersion) => {
      const actionKey = `dl:${version.id}`;
      setPendingAction(actionKey);
      try {
        const { url } = await getVersionSignedUrl(
          projectId,
          node.id,
          version.version,
          300,
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.rel = "noopener noreferrer";
        anchor.download = `${node.name}.v${version.version}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Download failed";
        showToast(message, "error");
      } finally {
        setPendingAction(null);
      }
    },
    [node.id, node.name, projectId, showToast],
  );

  const handleRestore = useCallback(
    async (version: FileVersion) => {
      if (!canEdit) return;
      const actionKey = `restore:${version.id}`;
      setPendingAction(actionKey);
      try {
        const result = await restoreFileVersion(
          projectId,
          node.id,
          version.version,
        );
        showToast(
          `Restored v${version.version} as v${result.version.version}`,
          "success",
        );
        onRestored?.(result.version);
        await refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Restore failed";
        showToast(message, "error");
      } finally {
        setPendingAction(null);
      }
    },
    [canEdit, node.id, onRestored, projectId, refresh, showToast],
  );

  const uploaderLabel = useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return "Unknown";
      const named = uploaderNames?.[userId];
      if (named) return named;
      return `${userId.slice(0, 8)}…`;
    },
    [uploaderNames],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        z-[300] / z-[299] keep the history dialog above the task detail
        panel (z-[201]). Without this override the dialog opens behind
        the panel — from the user's perspective, clicking the version
        chip "does nothing".
      */}
      <DialogContent
        className="z-[300] max-w-xl"
        overlayClassName="z-[299]"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-zinc-400" />
              Version history
            </DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs">
              {node.name}
              {currentVersion ? ` • currently on v${currentVersion}` : null}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 min-h-[160px] max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/40">
          {state.kind === "loading" || state.kind === "idle" ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading versions…
            </div>
          ) : state.kind === "error" ? (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-300">
              {state.message}
            </div>
          ) : state.versions.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500">
              No version history yet. The first upload seeded v1 but it hasn&apos;t been
              replaced.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {state.versions.map((version) => {
                const isCurrent = version.version === currentVersion;
                const dlKey = `dl:${version.id}`;
                const restoreKey = `restore:${version.id}`;
                return (
                  <li
                    key={version.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3",
                      isCurrent
                        ? "bg-indigo-50/60 dark:bg-indigo-500/10"
                        : "bg-transparent",
                    )}
                  >
                    <div className="mt-1 flex h-6 w-12 flex-shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      v{version.version}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {formatBytes(version.size)}
                        </span>
                        {isCurrent ? (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {formatDate(version.uploadedAt)} ·{" "}
                        {uploaderLabel(version.uploadedBy)}
                      </div>
                      {version.mimeType ? (
                        <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                          {version.mimeType}
                        </div>
                      ) : null}
                      {version.comment ? (
                        <div className="mt-2 rounded-md bg-white px-2 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
                          {version.comment}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        disabled={pendingAction === dlKey}
                        onClick={() => void handleDownload(version)}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        {pendingAction === dlKey ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        Download
                      </button>
                      {canEdit && !isCurrent ? (
                        <button
                          type="button"
                          disabled={pendingAction === restoreKey}
                          onClick={() => void handleRestore(version)}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                        >
                          {pendingAction === restoreKey ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          Restore
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 text-[11px] text-zinc-500">
          Restoring a version writes a new entry and never rewrites history.
          Historical blobs remain available for download.
        </div>
      </DialogContent>
    </Dialog>
  );
}
