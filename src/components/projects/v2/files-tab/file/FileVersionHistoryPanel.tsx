// Task 7.2 — `FileVersionHistoryPanel` component.
//
// A collapsible right-side drawer on FileView that displays all File_Version
// records for the currently viewed file, ordered by versionNumber descending.
//
// Requirements covered:
//   - Req 10.2: Display all File_Version records ordered by versionNumber desc
//   - Req 10.3: "View history" button visible to all roles
//   - Req 10.4: Role_Owner/Role_Member: render "Restore" action on each historical version row
//   - Req 10.5: Role_Viewer: no "Restore" action visible
//   - Req 10.6: On "Restore" click: call useFileVersions.restoreVersion(versionNumber), update MetadataStrip
//   - Req 10.7: Soft-deleted node: read-only mode, "This file is in the trash" banner, Restore disabled
//   - Req 14.1: Soft-deleted node: display all File_Version records in read-only mode
//   - Req 14.2: Soft-deleted node: display "This file is in the trash" notice
//   - Req 14.3: Soft-deleted node: "Restore" action disabled for all roles
//   - Req 17.2: performance.mark on first interactive state
//   - Req 24.2: Role_Viewer: no "Restore" actions on version rows

"use client";

import * as React from "react";
import { Download, History, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useToast } from "@/components/ui-custom/Toast";
import { useFileVersions } from "@/hooks/useFileVersions";
import { getVersionSignedUrl } from "@/app/actions/files/versions";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FileVersion } from "@/lib/db/schema";
import { VersionPill } from "../VersionPill";

type FileVersionWithUploader = FileVersion & {
  uploadedByName?: string | null;
  uploadedByUsername?: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────

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
    timeStyle: "medium",
  });
}

// ─── Props ───────────────────────────────────────────────────────────

export interface FileVersionHistoryPanelProps {
  projectId: string;
  nodeId: string;
  nodeName: string;
  /** Whether the current user can perform mutations (Role_Owner or Role_Member). */
  canEdit: boolean;
  /** Current version number from the node — used to highlight the active row. */
  currentVersion: number;
  /** Whether the node is soft-deleted (deletedAt is not null). Req 10.7, 14.1–14.3. */
  isDeleted?: boolean;
  /** Optional uploader display names keyed by user id. */
  uploaderNames?: Record<string, string>;
  onCompareClick?: (versionNumber: number) => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function FileVersionHistoryPanel({
  projectId,
  nodeId,
  nodeName,
  canEdit,
  currentVersion,
  isDeleted = false,
  uploaderNames,
  onCompareClick,
}: FileVersionHistoryPanelProps): React.JSX.Element {
  const { showToast } = useToast();
  const { versions, isLoading, error, listVersions, restoreVersion, deleteVersion } =
    useFileVersions(projectId, nodeId);

  const [pendingAction, setPendingAction] = React.useState<string | null>(null);

  // ── Fetch versions on mount ────────────────────────────────────────
  React.useEffect(() => {
    void listVersions();
  }, []);

  // ── Performance mark (Req 17.2) ────────────────────────────────────
  const perfMarkedRef = React.useRef(false);
  React.useEffect(() => {
    if (isLoading) return;
    if (perfMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:version-history-interactive");
    perfMarkedRef.current = true;
  }, [isLoading]);

  // ── Restore handler (Req 10.6) ─────────────────────────────────────
  const handleRestore = React.useCallback(
    async (version: FileVersion) => {
      // Req 14.3: Soft-deleted node — Restore disabled for all roles
      if (isDeleted) return;
      // Req 10.5, 24.2: Role_Viewer — no Restore action
      if (!canEdit) return;

      const actionKey = `restore:${version.id}`;
      setPendingAction(actionKey);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("file:version-changed-start", {
            detail: { nodeId },
          }),
        );
      }
      try {
        const result = await restoreVersion(version.version);
        if (result.success) {
          showToast(
            `Restored v${version.version} successfully`,
            "success",
          );
          
          if ((result as any).node) {
            useFilesWorkspaceStore.getState().setNodes(projectId, [(result as any).node]);
          }

          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("file:version-changed", {
                detail: { nodeId, version: version.version },
              }),
            );
          }

          // Emit telemetry (Req 16.4) — Task 7.5 wires this
          logger.metric("files_tab.version_restored", {
            module: "files-tab",
            projectId,
            nodeId,
            restoredFromVersion: version.version,
            newVersion: version.version,
          });
          // Refresh the list to show the updated active version
          await listVersions();
        } else {
          showToast(result.error || "Restore failed", "error");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Restore failed";
        showToast(message, "error");
      } finally {
        setPendingAction(null);
      }
    },
    [canEdit, isDeleted, projectId, nodeId, restoreVersion, listVersions, showToast],
  );

  // ── Download handler ────────────────────────────────────────────────
  const handleDownload = React.useCallback(
    async (version: FileVersion) => {
      const actionKey = `dl:${version.id}`;
      setPendingAction(actionKey);
      try {
        const { url } = await getVersionSignedUrl(
          projectId,
          nodeId,
          version.version,
          300,
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.rel = "noopener noreferrer";
        anchor.download = `${nodeName}.v${version.version}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Download failed";
        showToast(message, "error");
      } finally {
        setPendingAction(null);
      }
    },
    [projectId, nodeId, nodeName, showToast],
  );

  // ── Delete handler (Lead / Co-Lead) ─────────────────────────────────
  const handleDelete = React.useCallback(
    async (version: FileVersion) => {
      if (isDeleted) return;
      if (!canEdit) return;

      const confirmDelete = window.confirm(
        `Are you sure you want to permanently delete version ${version.version}? This will also delete its bytes from S3 and cannot be undone.`
      );
      if (!confirmDelete) return;

      const actionKey = `delete:${version.id}`;
      setPendingAction(actionKey);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("file:version-changed-start", {
            detail: { nodeId },
          }),
        );
      }
      try {
        const result = await deleteVersion(version.version);
        if (result.success) {
          showToast(`Deleted version ${version.version} successfully`, "success");
          
          if ((result as any).node) {
            useFilesWorkspaceStore.getState().setNodes(projectId, [(result as any).node]);
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("file:version-changed", {
                  detail: { nodeId, version: (result as any).nextActiveVersion },
                }),
              );
            }
          }
          await listVersions();
        } else {
          showToast((result as any).error || "Delete failed", "error");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Delete failed";
        showToast(message, "error");
      } finally {
        setPendingAction(null);
      }
    },
    [canEdit, isDeleted, projectId, nodeId, deleteVersion, listVersions, showToast]
  );

  // ── Uploader label helper ───────────────────────────────────────────
  const uploaderLabel = React.useCallback(
    (version: FileVersionWithUploader) => {
      const directName =
        typeof version.uploadedByName === "string"
          ? version.uploadedByName.trim()
          : "";
      if (directName) return directName;
      const directUsername =
        typeof version.uploadedByUsername === "string"
          ? version.uploadedByUsername.trim()
          : "";
      if (directUsername) return directUsername;
      const userId = version.uploadedBy;
      if (!userId) return "Unknown";
      const named = uploaderNames?.[userId];
      if (named) return named;
      return `${userId.slice(0, 8)}…`;
    },
    [uploaderNames],
  );

  // Determine if Restore should be shown at all:
  // - canEdit must be true (Role_Owner/Role_Member)
  // - node must NOT be soft-deleted
  const showRestoreAction = canEdit && !isDeleted;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      data-testid="file-version-history-panel"
      className={cn(
        "flex h-full w-full shrink-0 flex-col bg-white",
        "dark:bg-zinc-950",
      )}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Version History
        </h3>
        <div className="mt-0.5 flex items-center gap-1.5">
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {nodeName}
          </p>
          <VersionPill v={currentVersion} className="h-3.5 px-1 text-[9px]" />
        </div>
      </div>

      {/* Soft-deleted banner (Req 10.7, 14.2) */}
      {isDeleted && (
        <div
          data-testid="file-version-history-panel-deleted-banner"
          className={cn(
            "flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2",
            "dark:border-amber-800/50 dark:bg-amber-950/30",
          )}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            This file is in the trash
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading versions…
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-red-500">
            {error}
          </div>
        ) : versions.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No version history available.
          </div>
        ) : (
          <ul role="list" className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {versions.map((version) => {
              const isCurrent = version.version === currentVersion;
              const dlKey = `dl:${version.id}`;
              const restoreKey = `restore:${version.id}`;

              return (
                <li
                  key={version.id}
                  data-testid={`version-row-${version.version}`}
                  className={cn(
                    "px-3 py-2.5",
                    isCurrent
                      ? "bg-indigo-50/60 dark:bg-indigo-500/10"
                      : "bg-transparent",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {/* Version badge */}
                    <div className="mt-0.5 flex h-5 w-10 flex-shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      v{version.version}
                    </div>

                    {/* Version details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {formatBytes(version.size)}
                        </span>
                        {isCurrent && (
                          <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {formatDate(version.uploadedAt)} · {uploaderLabel(version)}
                      </div>
                      {version.comment && (
                        <div className="mt-1 rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
                          {version.comment}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={pendingAction === dlKey}
                        onClick={() => void handleDownload(version)}
                        aria-label={`Download version ${version.version}`}
                        className="inline-flex items-center justify-center gap-0.5 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        {pendingAction === dlKey ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                      </button>

                      {onCompareClick && (
                        <button
                          type="button"
                          onClick={() => onCompareClick(version.version)}
                          aria-label={`Compare version ${version.version}`}
                          className="inline-flex items-center justify-center gap-0.5 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Compare
                        </button>
                      )}

                      {/* Restore button: Req 10.4, 10.5, 14.3, 24.2 */}
                      {showRestoreAction && !isCurrent && (
                        <button
                          type="button"
                          disabled={pendingAction === restoreKey}
                          onClick={() => void handleRestore(version)}
                          aria-label={`Restore version ${version.version}`}
                          data-testid={`version-restore-${version.version}`}
                          className="inline-flex items-center justify-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                        >
                          {pendingAction === restoreKey ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                        </button>
                      )}

                      {/* Delete button: Leads/Co-Leads only */}
                      {canEdit && (
                        <button
                          type="button"
                          disabled={pendingAction === `delete:${version.id}`}
                          onClick={() => void handleDelete(version)}
                          aria-label={`Delete version ${version.version}`}
                          className="inline-flex items-center justify-center gap-0.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                        >
                          {pendingAction === `delete:${version.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer note */}
      <div className="shrink-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
          Restoring a version writes a new entry and never rewrites history.
        </p>
      </div>
    </div>
  );
}

export default FileVersionHistoryPanel;
