"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  Paperclip,
} from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes, getProjectRecentNodes } from "@/app/actions/files";
import { getTaskLinkCounts } from "@/app/actions/files/links";
import { TaskFilesExplorer } from "@/components/projects/v2/tasks/components/TaskFilesExplorer";
import { TaskFilesActionMenu } from "@/components/projects/v2/tasks/components/TaskFilesActionMenu";
import { TaskFileAttachPickerDialog } from "@/components/projects/v2/tasks/components/TaskFileAttachPickerDialog";
import { TaskFileDecisionDialog } from "@/components/projects/v2/tasks/components/TaskFileDecisionDialog";
import { TaskFileUploadQueueList } from "@/components/projects/v2/tasks/components/TaskFileUploadQueueList";
import { TaskFilesEmptyState } from "@/components/projects/v2/tasks/components/TaskFilesEmptyState";
import { TaskFilesWarningBanner } from "@/components/projects/v2/tasks/components/TaskFilesWarningBanner";
import { FileVersionHistoryDrawer } from "@/components/projects/v2/tasks/components/FileVersionHistoryDrawer";
import {
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
import {
  buildTaskFileChoicePreview,
  buildTaskFileOutcomeSummary,
  formatTaskFileRoleSummaryLabel,
  getTaskFileResolutionChoiceCopy,
  summarizeTaskFileRoles,
} from "@/lib/projects/task-file-presentation";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [showWarningDetails, setShowWarningDetails] = useState(false);
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
    return summarizeTaskFileRoles(attachments);
  }, [attachments]);

  const roleSummaryLabel = useMemo(() => {
    return formatTaskFileRoleSummaryLabel(roleSummary);
  }, [roleSummary]);

  const fileOutcomeSummary = useMemo(() => {
    return buildTaskFileOutcomeSummary(attachments, fileWarnings);
  }, [attachments, fileWarnings]);

  const matchedNodeSharedCount = pendingResolution?.resolution.matchedNodeId
    ? linkCounts[pendingResolution.resolution.matchedNodeId] ?? 0
    : 0;

  const handleOpenInWorkspace = useCallback(
    (node: ProjectNode) => {
      const nodePath = node.path?.trim() || node.name?.trim();
      if (!nodePath) {
        showToast("This file does not have a workspace path yet.", "error");
        return;
      }

      const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
      nextParams.set("tab", "files");
      nextParams.set("path", nodePath);
      nextParams.delete("line");
      nextParams.delete("column");
      router.push(`${pathname}?${nextParams.toString()}`);
    },
    [pathname, router, searchParams, showToast],
  );

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
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {roleSummaryLabel}
          </p>
          <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Finish line
            </div>
            <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {fileOutcomeSummary.headline}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {fileOutcomeSummary.detail}
            </div>
          </div>
          {fileWarnings.length > 0 ? (
            <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {fileWarningSummary || "Some file relationships still need review before this task is truly complete."}
            </p>
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
          <TaskFilesActionMenu
            canEdit={canEdit}
            disabled={isUploading}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={onUploadFolders ? () => folderInputRef.current?.click() : undefined}
            onPickExisting={() => void openPicker()}
          />
        </div>
      </div>

      <TaskFilesWarningBanner
        warnings={fileWarnings}
        summary={fileWarningSummary}
        showDetails={showWarningDetails}
        onToggleDetails={() => setShowWarningDetails((current) => !current)}
      />

      {pendingResolution || reuploadPrompt ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          <div className="font-medium">
            File intake is paused until you confirm the current decision.
          </div>
          <div className="mt-1 text-xs text-indigo-700 dark:text-indigo-200">
            {pendingResolution
              ? `Finish the ${pendingResolution.candidateType} placement decision so the remaining files can be attached cleanly.`
              : `Decide whether ${reuploadPrompt?.filename ?? "this file"} should become a new version or a separate task file.`}
          </div>
        </div>
      ) : null}

      <TaskFileUploadQueueList queue={uploadQueue} />

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
            onOpenInWorkspace={handleOpenInWorkspace}
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
            currentDeliverableId={fileOutcomeSummary.currentDeliverableId}
            linkCounts={linkCounts}
            onReorder={() => {
              // Ordering persists inside the explorer; the parent resource reloads linked nodes after mutations.
            }}
          />
        )}
      </div>

      <TaskFileAttachPickerDialog
        open={picker.open}
        query={picker.open ? picker.query : ""}
        loading={picker.open ? picker.loading : false}
        results={picker.open ? picker.results : []}
        suggestions={picker.open ? picker.suggestions : []}
        attachments={attachments}
        canEdit={canEdit}
        onQueryChange={(query) => {
          setPicker((current) => (current.open ? { ...current, query } : current));
          if (pickerTimerRef.current) clearTimeout(pickerTimerRef.current);
          pickerTimerRef.current = setTimeout(() => {
            void runPickerSearch(query.trim());
          }, 180);
        }}
        onAttach={async (node) => {
          const result = await onAttachExisting(node);
          if (result.success) closePicker();
        }}
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
      />

      {pendingResolution ? (
        <TaskFileDecisionDialog
          open
          title={pendingResolution.candidateType === "folder" ? "Resolve folder placement" : "Resolve file action"}
          description={
            pendingResolution.candidateType === "folder"
              ? `Folder "${pendingResolution.candidateName}" overlaps with something already linked. Decide whether this should be a new root folder, a subfolder, or part of an existing folder context.`
              : `${pendingResolution.candidateName} needs a quick decision so the task file list stays clean and version choices stay obvious.`
          }
          summary={
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {pendingResolution.resolution.reason}
              </div>
              <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                <div>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Suggested action:</span>{" "}
                  {
                      getTaskFileResolutionChoiceCopy(
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
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Matched item:</span>{" "}
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
                <div className="sm:col-span-2">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    After this choice:
                  </span>{" "}
                  {
                    buildTaskFileChoicePreview(
                      pendingResolution.resolution.recommendedChoice,
                      pendingResolution.candidateType,
                    ).detail
                  }
                </div>
              </div>
            </div>
          }
          error={resolutionError}
          isSubmitting={isResolving}
          footerHint="We always ask before replacing, merging, or folding files into an existing folder context, so task attachments stay predictable."
          options={pendingResolution.options.map((choice) => {
            const copy = getTaskFileResolutionChoiceCopy(choice, pendingResolution.candidateType);
            return {
              value: choice,
              label: copy.label,
              description: copy.description,
              recommended: pendingResolution.resolution.recommendedChoice === choice,
            };
          })}
          onSelect={async (value) => {
            const choice = value as TaskFileResolutionChoice;
            setResolutionError(null);
            setIsResolving(true);
            const result = await onResolvePendingResolution(choice);
            if (!result.success) {
              setResolutionError(result.error || "Could not apply that file choice.");
            }
            setIsResolving(false);
          }}
        />
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
        <TaskFileDecisionDialog
          open
          title="You edited this file"
          description={
            reuploadPrompt.confidence === "changed"
              ? `${reuploadPrompt.filename} looks different from when you opened it. Decide whether this should become the next version or a separate task file.`
              : `${reuploadPrompt.filename} was opened from this task. Decide whether it should become the next version or stay separate.`
          }
          options={[
            {
              value: "replace",
              label: "Save as new version",
              description: "Keeps the current version history intact and makes this the latest file.",
              recommended: true,
            },
            {
              value: "attach_new",
              label: "Attach as a new file",
              description: "Uploads alongside the original and lets you decide later how it relates.",
            },
            {
              value: "cancel",
              label: "Cancel",
              description: "Leave the current attachment untouched for now.",
            },
          ]}
          footerHint="Version updates stay downloadable from the history drawer, so using a new version is the cleanest option when this file edits an existing attachment."
          onSelect={async (value) => {
            if (value === "replace") {
              await confirmSaveAsNewVersion();
              return;
            }
            if (value === "attach_new") {
              await attachAsNewFromPrompt();
              return;
            }
            setReuploadPrompt(null);
          }}
          onOpenChange={(open) => {
            if (!open) setReuploadPrompt(null);
          }}
        />
      ) : null}
    </div>
  );
}
