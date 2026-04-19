"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  FileText,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  Search,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes, getProjectRecentNodes } from "@/app/actions/files";
import { getTaskLinkCounts } from "@/app/actions/files/links";
import { TaskFilesExplorer } from "@/components/projects/v2/tasks/components/TaskFilesExplorer";
import { TaskFilesEmptyState } from "@/components/projects/v2/tasks/components/TaskFilesEmptyState";
import { FileVersionHistoryDrawer } from "@/components/projects/v2/tasks/components/FileVersionHistoryDrawer";
import {
  inferTaskFileRole,
  type TaskFileReadinessWarning,
  type TaskFileResolutionChoice,
} from "@/lib/projects/task-file-intelligence";
import type { TaskFilePendingResolution, TaskFileUploadStatus } from "@/hooks/useTaskFileMutations";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import { computeContentHash } from "@/lib/files/content-hash";
import { findSessionByFilename, clearSession } from "@/lib/files/open-file-sessions";
import {
  extractFoldersFromDataTransfer,
  extractFoldersFromWebkitInput,
  type DroppedFolder,
  type ExtractedDrop,
} from "@/lib/files/folder-drop";

interface FilesTabProps {
  projectId: string;
  /** Used by OpenInIdeMenu to build local paths like ~/Downloads/NB-Workspace/<slug>/<file>. */
  projectSlug?: string;
  taskId: string;
  taskTitle?: string;
  canEdit: boolean;
  attachments: (ProjectNode & { annotation?: string | null })[];
  isLoading: boolean;
  error: string | null;
  uploadQueue: TaskFileUploadStatus[];
  fileWarnings: TaskFileReadinessWarning[];
  fileWarningSummary: string | null;
  pendingResolution: TaskFilePendingResolution | null;
  isUploading: boolean;
  onUploadFiles: (files: File[]) => Promise<{ success: boolean; error?: string }>;
  /**
   * Wave 3 — handle a folder drop (webkitGetAsEntry) or a folder picker
   * selection (<input webkitdirectory />). The FilesTab normalizes both
   * into `DroppedFolder[]` before calling.
   */
  onUploadFolders?: (
    folders: DroppedFolder[],
  ) => Promise<{ success: boolean; error?: string }>;
  onAttachExisting: (node: ProjectNode) => Promise<{ success: boolean; error?: string }>;
  onUnlink: (nodeId: string) => Promise<{ success: boolean; error?: string }>;
  onOpenFile: (node: ProjectNode) => Promise<void> | void;
  onResolvePendingResolution: (
    choice: TaskFileResolutionChoice,
  ) => Promise<{ success: boolean; error?: string }>;
  /**
   * Append a new version to an existing node. Wired from
   * `useTaskFileMutations.saveAsNewVersion`. The drop-zone calls this when
   * the user confirms a re-upload dialog.
   */
  onSaveAsNewVersion?: (
    nodeId: string,
    file: File,
    options?: { comment?: string | null },
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Pending re-upload after a drop: the user edited a file they opened in an
 * IDE and dropped it back. We detected a matching IDB session + (optionally)
 * hash mismatch and need their confirmation before calling
 * `replaceNodeWithNewVersion`.
 */
type ReuploadPrompt = {
  file: File;
  nodeId: string;
  filename: string;
  /** "changed" when hashes diverge, "unknown" for prefix-hash / missing hash. */
  confidence: "changed" | "unknown";
};

type PickerState =
  | { open: false }
  | { open: true; query: string; loading: boolean; results: ProjectNode[]; suggestions: ProjectNode[] };

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function resolutionChoiceCopy(
  choice: TaskFileResolutionChoice,
  candidateType: "file" | "folder" = "file",
) {
  // Folder-specific copy — Wave 3 adds `merge`, `subfolder`, and reworded
  // `replace`/`attach_new` labels so the choices are unambiguous when the
  // candidate is a folder rather than a single file.
  if (candidateType === "folder") {
    if (choice === "replace") {
      return {
        label: "Replace folder contents",
        description:
          "Upload into the existing linked folder. Files with matching names collide — we'll suffix them so nothing is silently overwritten.",
      };
    }
    if (choice === "merge") {
      return {
        label: "Merge into existing folder",
        description:
          "Drop these files into the linked folder. Matching names get saved as new files alongside originals.",
      };
    }
    if (choice === "subfolder") {
      return {
        label: "Add as a subfolder",
        description:
          "Create a new folder inside the linked one. Keeps the original contents untouched.",
      };
    }
    if (choice === "attach_new") {
      return {
        label: "Attach as new folder",
        description:
          "Create a fresh folder at the task root and link it. Existing attachments are left alone.",
      };
    }
    return {
      label: "Cancel",
      description: "Leave the drop unresolved. Nothing gets uploaded.",
    };
  }

  if (choice === "replace") {
    return {
      label: "Replace existing link",
      description: "Use the new file for this task and unlink the older direct task file.",
    };
  }
  if (choice === "link_existing") {
    return {
      label: "Keep folder context",
      description: "Use the file that already exists under the linked folder without creating a second root attachment.",
    };
  }
  if (choice === "attach_new") {
    return {
      label: "Attach as new",
      description: "Keep the current linked files untouched and add this as a separate task attachment.",
    };
  }
  return {
    label: "Cancel",
    description: "Leave the file unresolved for now and keep the current task attachments unchanged.",
  };
}

export default function FilesTab({
  projectId,
  projectSlug,
  taskId,
  taskTitle,
  canEdit,
  attachments,
  isLoading,
  error,
  uploadQueue,
  fileWarnings,
  fileWarningSummary,
  pendingResolution,
  isUploading,
  onUploadFiles,
  onUploadFolders,
  onAttachExisting,
  onUnlink,
  onOpenFile,
  onResolvePendingResolution,
  onSaveAsNewVersion,
}: FilesTabProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Separate ref for the folder picker — Chromium requires the element to
   *  carry `webkitdirectory` at render time; you can't toggle it on the
   *  same hidden input used for plain files without re-mounting. */
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pickerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [picker, setPicker] = useState<PickerState>({ open: false });
  const [linkCounts, setLinkCounts] = useState<Record<string, number>>({});
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [historyNode, setHistoryNode] = useState<ProjectNode | null>(null);
  const [reuploadPrompt, setReuploadPrompt] = useState<ReuploadPrompt | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessingDrop, setIsProcessingDrop] = useState(false);
  const dragCounterRef = useRef(0);

  const openPicker = useCallback(async () => {
    setPicker({ open: true, query: "", loading: true, results: [], suggestions: [] });
    try {
      const recent = await getProjectRecentNodes(projectId, 5);
      setPicker((current) =>
        current.open ? { ...current, loading: false, suggestions: recent } : current,
      );
    } catch {
      setPicker((current) => (current.open ? { ...current, loading: false } : current));
    }
  }, [projectId]);

  const closePicker = useCallback(() => {
    setPicker({ open: false });
  }, []);

  const runPickerSearch = useCallback(
    async (query: string) => {
      if (!query) {
        setPicker((current) => (current.open ? { ...current, query, results: [] } : current));
        return;
      }

      setPicker((current) => (current.open ? { ...current, query, loading: true } : current));
      try {
        const result = await getProjectNodes(projectId, null, query);
        const nodes = Array.isArray(result) ? result : result.nodes;
        const validNodes = (nodes || []).filter((node) => node.type === "file" || node.type === "folder");
        setPicker((current) =>
          current.open ? { ...current, loading: false, results: validNodes } : current,
        );
      } catch {
        setPicker((current) => (current.open ? { ...current, loading: false, results: [] } : current));
      }
    },
    [projectId],
  );

  useEffect(() => {
    return () => {
      if (pickerTimerRef.current) clearTimeout(pickerTimerRef.current);
    };
  }, []);

  /**
   * Decide what to do with files dropped onto the tab: for each file,
   * (1) look up any IDB open-session for the filename, (2) hash the dropped
   * bytes, (3) compare to the session's originalHash. If the file appears
   * to be a re-upload we pause and ask the user. Otherwise we forward to
   * the normal `onUploadFiles` flow.
   *
   * We process files sequentially so the prompt dialog can block cleanly —
   * showing one confirmation per file in quick succession is better than
   * an N-way modal stack.
   */
  const handleDroppedFiles = useCallback(
    async (files: File[]) => {
      if (!canEdit || files.length === 0) return;
      setIsProcessingDrop(true);
      try {
        const forwardBatch: File[] = [];
        for (const file of files) {
          const session = await findSessionByFilename(file.name).catch(() => null);
          if (!session || !onSaveAsNewVersion) {
            forwardBatch.push(file);
            continue;
          }

          const attached = attachments.some((attachment) => attachment.id === session.nodeId);
          if (!attached) {
            forwardBatch.push(file);
            continue;
          }

          const hashResult = await computeContentHash(file).catch(() => null);
          if (
            hashResult?.kind === "full" &&
            session.originalHash &&
            hashResult.hashHex === session.originalHash
          ) {
            showToast(`No changes since open — ${file.name} is identical.`, "info");
            continue;
          }

          // Either the hash differs, or we couldn't compare cleanly (prefix
          // hash on a large file). Prompt the user.
          setReuploadPrompt({
            file,
            nodeId: session.nodeId,
            filename: file.name,
            confidence:
              hashResult?.kind === "full" && session.originalHash ? "changed" : "unknown",
          });
          // Stop processing further drops until the user resolves this one.
          return;
        }

        if (forwardBatch.length > 0) {
          await onUploadFiles(forwardBatch);
        }
      } finally {
        setIsProcessingDrop(false);
      }
    },
    [attachments, canEdit, onSaveAsNewVersion, onUploadFiles, showToast],
  );

  const handleDropZoneDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragCounterRef.current += 1;
      setIsDragActive(true);
    },
    [canEdit],
  );

  const handleDropZoneDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canEdit],
  );

  const handleDropZoneDragLeave = useCallback(() => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  /**
   * Route a normalized drop through the right mutation. Loose files take
   * the same path the existing drop-zone used (hash-check → upload or
   * prompt). Folders go through `onUploadFolders` which invokes the
   * resolver per-folder and queues a prompt when needed.
   */
  const dispatchExtractedDrop = useCallback(
    async (extracted: ExtractedDrop) => {
      if (extracted.folders.length > 0 && onUploadFolders) {
        await onUploadFolders(extracted.folders);
      }
      if (extracted.looseFiles.length > 0) {
        await handleDroppedFiles(extracted.looseFiles);
      }
      if (extracted.folders.length > 0 && !onUploadFolders) {
        // Fallback: flatten every folder's files and forward as loose
        // uploads so nothing is silently dropped on non-Wave-3 callers.
        const flat = extracted.folders.flatMap((folder) =>
          folder.files.map((entry) => entry.file),
        );
        if (flat.length > 0) await handleDroppedFiles(flat);
      }
    },
    [handleDroppedFiles, onUploadFolders],
  );

  const handleDropZoneDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragActive(false);

      // Capture synchronously — extractFoldersFromDataTransfer consumes
      // the DataTransfer object asynchronously, and browsers invalidate
      // `dataTransfer.items` once the drop event handler returns. We
      // snapshot into `ExtractedDrop` via an immediate traversal.
      const dataTransfer = event.dataTransfer;
      void (async () => {
        setIsProcessingDrop(true);
        try {
          const extracted = await extractFoldersFromDataTransfer(dataTransfer);
          if (extracted.folders.length === 0 && extracted.looseFiles.length === 0) {
            // webkitGetAsEntry returned nothing (rare — e.g. Safari on a
            // pure File drop) — fall back to the legacy files array.
            const files = Array.from(dataTransfer.files || []);
            if (files.length > 0) await handleDroppedFiles(files);
            return;
          }
          await dispatchExtractedDrop(extracted);
        } finally {
          setIsProcessingDrop(false);
        }
      })();
    },
    [canEdit, dispatchExtractedDrop, handleDroppedFiles],
  );

  const confirmSaveAsNewVersion = useCallback(async () => {
    if (!reuploadPrompt || !onSaveAsNewVersion) return;
    const { file, nodeId } = reuploadPrompt;
    setReuploadPrompt(null);
    const result = await onSaveAsNewVersion(nodeId, file);
    if (result.success) {
      showToast(`Saved ${file.name} as a new version.`, "success");
      // Best-effort: clear the IDB session so the next drop of the same
      // filename won't re-match against stale state.
      await clearSession(`${nodeId}::${file.name}`).catch(() => null);
    } else {
      showToast(result.error || "Failed to save new version", "error");
    }
  }, [onSaveAsNewVersion, reuploadPrompt, showToast]);

  const attachAsNewFromPrompt = useCallback(async () => {
    if (!reuploadPrompt) return;
    const { file } = reuploadPrompt;
    setReuploadPrompt(null);
    await onUploadFiles([file]);
  }, [onUploadFiles, reuploadPrompt]);

  useEffect(() => {
    const relevantIds = Array.from(
      new Set(
        [
          ...attachments.map((attachment) => attachment.id),
          pendingResolution?.resolution.matchedNodeId ?? null,
          pendingResolution?.candidateNodeId ?? null,
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    if (relevantIds.length === 0) {
      setLinkCounts({});
      return;
    }

    let cancelled = false;
    void getTaskLinkCounts(projectId, relevantIds)
      .then((counts) => {
        if (!cancelled) setLinkCounts(counts);
      })
      .catch(() => {
        if (!cancelled) setLinkCounts({});
      });

    return () => {
      cancelled = true;
    };
  }, [attachments, pendingResolution, projectId]);

  const headerSubtitle = useMemo(() => {
    const base = `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`;
    return taskTitle ? `${base} • ${taskTitle}` : base;
  }, [attachments.length, taskTitle]);

  const roleSummary = useMemo(() => {
    const counts = attachments.reduce(
      (acc, attachment) => {
        const role = inferTaskFileRole({
          name: attachment.name,
          type: attachment.type,
          path: attachment.path,
          annotation: attachment.annotation ?? null,
        });
        acc[role] += 1;
        return acc;
      },
      { deliverable: 0, reference: 0, working: 0 },
    );

    return [
      counts.deliverable > 0 ? { label: "Deliverables", count: counts.deliverable } : null,
      counts.working > 0 ? { label: "Working", count: counts.working } : null,
      counts.reference > 0 ? { label: "Reference", count: counts.reference } : null,
    ].filter(Boolean) as { label: string; count: number }[];
  }, [attachments]);

  const matchedNodeSharedCount = pendingResolution?.resolution.matchedNodeId
    ? linkCounts[pendingResolution.resolution.matchedNodeId] ?? 0
    : 0;

  return (
    <div
      className={cn(
        "relative space-y-4 p-6",
        isDragActive &&
          "ring-2 ring-indigo-400 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900",
      )}
      onDragEnter={handleDropZoneDragEnter}
      onDragOver={handleDropZoneDragOver}
      onDragLeave={handleDropZoneDragLeave}
      onDrop={handleDropZoneDrop}
    >
      {isDragActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50/80 text-sm font-medium text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">
          Drop to attach or update a file version
        </div>
      ) : null}
      {isProcessingDrop ? (
        <div className="pointer-events-none absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white shadow">
          <Loader2 className="h-3 w-3 animate-spin" />
          Analyzing…
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Attachments</h3>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500">{headerSubtitle}</p>
          {roleSummary.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {roleSummary.map((item) => (
                <span
                  key={item.label}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                >
                  {item.label} {item.count}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            disabled={!canEdit || isUploading}
            id={`task-attach-upload-${taskId}`}
            onChange={(event) => {
              const incoming = Array.from(event.target.files || []);
              if (incoming.length > 0) {
                void onUploadFiles(incoming);
              }
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
              }
            }}
          />
          {/*
           * Wave 3 — keyboard-accessible folder picker. Hidden native
           * <input type="file" webkitdirectory /> normalized via
           * extractFoldersFromWebkitInput. Ref-only (not id-linked) so
           * we can keep the button visual treatment consistent.
           */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            disabled={!canEdit || isUploading}
            // React treats these as unknown attrs but the browser honors them.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(event) => {
              const incoming = event.target.files;
              if (incoming && incoming.length > 0) {
                const extracted = extractFoldersFromWebkitInput(incoming);
                if (extracted.folders.length > 0 && onUploadFolders) {
                  void onUploadFolders(extracted.folders);
                } else if (extracted.looseFiles.length > 0) {
                  void onUploadFiles(extracted.looseFiles);
                }
              }
              if (folderInputRef.current) folderInputRef.current.value = "";
            }}
          />
          <label
            htmlFor={`task-attach-upload-${taskId}`}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              canEdit
                ? "cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700"
                : "cursor-not-allowed bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
            ].join(" ")}
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </label>

          {onUploadFolders ? (
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={!canEdit || isUploading}
              className={[
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                canEdit && !isUploading
                  ? "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  : "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800",
              ].join(" ")}
              title="Upload a folder"
            >
              <FolderPlus className="h-4 w-4" />
              Upload folder
            </button>
          ) : null}

          <button
            type="button"
            onClick={openPicker}
            disabled={!canEdit}
            className={[
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              canEdit
                ? "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                : "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800",
            ].join(" ")}
          >
            <Plus className="h-4 w-4" />
            Attach existing
          </button>
        </div>
      </div>

      {fileWarnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-2">
              <div className="font-medium">
                {fileWarningSummary || "This task’s files still need a quick follow-up."}
              </div>
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-200">
                {fileWarnings.map((warning) => (
                  <li key={warning.code} className="list-inside list-disc">
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {uploadQueue.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {uploadQueue.map((item) => {
            const isAwaitingResolution = item.status === "awaiting_resolution";
            const progressLabel =
              item.status === "success"
                ? "Uploaded"
                : item.status === "error"
                  ? item.error || "Upload failed"
                  : isAwaitingResolution
                    ? "Needs a decision before this file can be attached cleanly."
                    : `${item.progress}%`;

            return (
              <div
                key={item.id}
                className="flex items-center justify-between rounded border bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <div className="min-w-0 flex-1 pr-4">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {item.filename}
                  </div>
                  <div
                    className={cn(
                      "mt-1 truncate text-xs",
                      item.status === "error"
                        ? "text-rose-500"
                        : isAwaitingResolution
                          ? "text-amber-600 dark:text-amber-300"
                          : "text-zinc-500",
                    )}
                  >
                    {progressLabel}
                  </div>
                </div>

                {item.status === "uploading" ? (
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div className="h-full bg-indigo-600 transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                ) : item.status === "success" ? (
                  <div className="h-4 w-4 rounded-full bg-emerald-500" />
                ) : item.status === "awaiting_resolution" ? (
                  <div className="h-4 w-4 rounded-full bg-amber-500" />
                ) : (
                  <div className="h-4 w-4 rounded-full bg-rose-500" />
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-[200px]" data-testid="task-files-list-region">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : attachments.length === 0 ? (
          <TaskFilesEmptyState
            canEdit={canEdit}
            isDragActive={isDragActive}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={
              onUploadFolders ? () => folderInputRef.current?.click() : undefined
            }
            onPickExisting={openPicker}
          />
        ) : (
          <TaskFilesExplorer
            taskId={taskId}
            projectId={projectId}
            projectSlug={projectSlug}
            linkedNodes={attachments}
            canEdit={canEdit}
            onUnlink={(nodeId) => {
              void onUnlink(nodeId);
            }}
            onOpenFile={(node) => {
              void onOpenFile(node);
            }}
            onShowHistory={(node) => setHistoryNode(node)}
            onReplaceWithNewVersion={
              onSaveAsNewVersion
                ? async (node, file) => {
                    const result = await onSaveAsNewVersion(node.id, file);
                    if (result.success) {
                      showToast(`Saved ${file.name} as a new version.`, "success");
                    } else {
                      showToast(
                        result.error || "Failed to save new version",
                        "error",
                      );
                    }
                    return result;
                  }
                : undefined
            }
            onReorder={() => {
              // Ordering persists inside the explorer; the parent resource reloads linked nodes after mutations.
            }}
          />
        )}
      </div>

      {picker.open ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
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
                onClick={closePicker}
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
                  value={picker.query}
                  onChange={(event) => {
                    const query = event.target.value;
                    setPicker((current) => (current.open ? { ...current, query } : current));
                    if (pickerTimerRef.current) clearTimeout(pickerTimerRef.current);
                    pickerTimerRef.current = setTimeout(() => {
                      void runPickerSearch(query.trim());
                    }, 180);
                  }}
                  placeholder="Search project files/folders by name..."
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-950"
                />
              </div>

              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                {picker.loading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                ) : !picker.query && picker.suggestions.length > 0 ? (
                  <div className="space-y-1 p-2">
                    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Recently updated files
                    </div>
                    {picker.suggestions.map((node) => {
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
                                : `${formatBytes(node.size)} • Modified ${node.updatedAt ? new Date(node.updatedAt).toLocaleDateString() : "Unknown"}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit || alreadyAttached}
                            onClick={async () => {
                              const result = await onAttachExisting(node);
                              if (result.success) closePicker();
                            }}
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
                ) : picker.query && picker.results.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-500">
                    No matches found for &quot;{picker.query}&quot;
                  </div>
                ) : picker.query ? (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    <div className="bg-zinc-50 px-5 py-2 text-xs font-semibold text-zinc-500 dark:bg-zinc-900/50">
                      Search Results
                    </div>
                    {picker.results.map((node) => {
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
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit || alreadyAttached}
                            onClick={async () => {
                              const result = await onAttachExisting(node);
                              if (result.success) closePicker();
                            }}
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
          </div>
        </div>
      ) : null}

      {pendingResolution ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {pendingResolution.candidateType === "folder"
                  ? "Resolve folder drop"
                  : "Resolve file action"}
              </h4>
              <p className="mt-1 text-sm text-zinc-500">
                {pendingResolution.candidateType === "folder"
                  ? `Folder "${pendingResolution.candidateName}" overlaps with something already linked. Pick how it should land.`
                  : `${pendingResolution.candidateName} needs a quick decision before the task file list can stay clean.`}
              </p>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {pendingResolution.resolution.reason}
                </div>
                <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                  <div>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Suggested action:</span>{" "}
                    {
                      resolutionChoiceCopy(
                        pendingResolution.resolution.recommendedChoice,
                        pendingResolution.candidateType,
                      ).label
                    }
                  </div>
                  <div>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Confidence:</span>{" "}
                    {pendingResolution.resolution.confidence}
                  </div>
                  {pendingResolution.resolution.matchedNodeName ? (
                    <div className="sm:col-span-2">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">Matched node:</span>{" "}
                      {pendingResolution.resolution.matchedNodeName}
                      {matchedNodeSharedCount > 1 ? ` • Shared across ${matchedNodeSharedCount} tasks` : ""}
                    </div>
                  ) : null}
                  {pendingResolution.resolution.linkedFolderName ? (
                    <div className="sm:col-span-2">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">Linked folder:</span>{" "}
                      {pendingResolution.resolution.linkedFolderName}
                    </div>
                  ) : null}
                </div>
              </div>

              {resolutionError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                  {resolutionError}
                </div>
              ) : null}

              <div className="space-y-2">
                {pendingResolution.options.map((choice) => {
                  const copy = resolutionChoiceCopy(choice, pendingResolution.candidateType);
                  const isRecommended = pendingResolution.resolution.recommendedChoice === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      disabled={isResolving}
                      onClick={async () => {
                        setResolutionError(null);
                        setIsResolving(true);
                        const result = await onResolvePendingResolution(choice);
                        if (!result.success) {
                          setResolutionError(result.error || "Could not apply that file choice.");
                        }
                        setIsResolving(false);
                      }}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        isRecommended
                          ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500/70 dark:bg-indigo-500/10"
                          : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/70",
                      )}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {copy.label}
                          {isRecommended ? (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                              Recommended
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-zinc-500">{copy.description}</p>
                      </div>
                      {isResolving ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-zinc-400" /> : null}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                We always ask before replacing or folding a file into an existing folder context, so task attachments stay predictable.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {historyNode ? (
        <FileVersionHistoryDrawer
          projectId={projectId}
          node={historyNode}
          open={!!historyNode}
          onOpenChange={(open) => {
            if (!open) setHistoryNode(null);
          }}
          canEdit={canEdit}
        />
      ) : null}

      {reuploadPrompt ? (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                You edited this file
              </h4>
              <p className="mt-1 text-sm text-zinc-500">
                {reuploadPrompt.confidence === "changed"
                  ? `${reuploadPrompt.filename} looks different from when you opened it. Save it as a new version of the existing attachment?`
                  : `${reuploadPrompt.filename} was opened from this task. Save it as a new version of the existing attachment?`}
              </p>
            </div>
            <div className="space-y-2 px-5 py-4">
              <button
                type="button"
                onClick={() => void confirmSaveAsNewVersion()}
                className="flex w-full items-start gap-3 rounded-xl border border-indigo-500 bg-indigo-50 px-4 py-3 text-left text-sm font-medium text-indigo-800 transition-colors hover:bg-indigo-100 dark:border-indigo-500/70 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20"
              >
                <span className="flex-1">
                  <span className="block">Save as new version</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-indigo-700/80 dark:text-indigo-200/70">
                    Keeps the previous blob downloadable from the history drawer.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void attachAsNewFromPrompt()}
                className="flex w-full items-start gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span className="flex-1">
                  <span className="block">Attach as a new file</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                    Uploads alongside the original and lets you decide later.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setReuploadPrompt(null)}
                className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
