"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  FolderDown,
  FolderUp,
  Loader2,
  RefreshCcw,
  Search,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { FolderPicker } from "@/components/projects/v2/explorer/ExplorerDialogsHost";
import type { TaskFileRole } from "@/lib/projects/task-file-intelligence";

export type FilesUploadIntent =
  | "project"
  | "reference"
  | "working"
  | "deliverable"
  | "version";

export interface FilesTabUploadConfirmResult {
  intent: FilesUploadIntent;
  targetFolderId: string | null;
  versionNodeId?: string;
  taskId?: string;
  label?: string;
  role?: TaskFileRole;
}

export interface FilesTabUploadModalProps {
  projectId: string;
  isOpen: boolean;
  files: File[];
  currentFolderId: string | null;
  currentFolderName?: string;
  existingFiles: ProjectNode[];
  activeTaskId?: string | null;
  activeTaskTitle?: string | null;
  isProcessing?: boolean;
  onConfirm: (result: FilesTabUploadConfirmResult) => void;
  onCancel: () => void;
}

interface SearchableTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  taskNumber: number | null;
  projectKey: string | null;
  assigneeName: string | null;
}

export function FilesTabUploadModal({
  projectId,
  isOpen,
  files,
  currentFolderId,
  currentFolderName = "Project Root",
  existingFiles,
  activeTaskId = null,
  activeTaskTitle = null,
  isProcessing = false,
  onConfirm,
  onCancel,
}: FilesTabUploadModalProps) {
  const fileCount = files.length;
  const singleFile = fileCount === 1 ? files[0] : null;

  // Detect if any existing file matches the dropped file's name (case-insensitive)
  const matchingExistingFile = useMemo(() => {
    if (!singleFile) return null;
    const lowerName = singleFile.name.trim().toLowerCase();
    return (
      existingFiles.find(
        (node) => node.type === "file" && node.name.trim().toLowerCase() === lowerName,
      ) ?? null
    );
  }, [singleFile, existingFiles]);

  const versionCandidates = useMemo(
    () => existingFiles.filter((node) => node.type === "file"),
    [existingFiles],
  );

  // Intent defaults: if dropped file matches an existing file, prompt versioning; otherwise project files
  const [intent, setIntent] = useState<FilesUploadIntent>(() =>
    matchingExistingFile ? "version" : "project",
  );

  const [destinationFolderId, setDestinationFolderId] = useState<string | null>(
    currentFolderId,
  );
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [versionNodeId, setVersionNodeId] = useState<string>(
    matchingExistingFile ? matchingExistingFile.id : versionCandidates[0]?.id ?? "",
  );
  const [label, setLabel] = useState<string>("");

  // Task selection state
  const [selectedTaskId, setSelectedTaskId] = useState<string>(activeTaskId ?? "");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskResults, setTaskResults] = useState<SearchableTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Synchronize when matchingExistingFile changes
  useEffect(() => {
    if (matchingExistingFile) {
      setIntent("version");
      setVersionNodeId(matchingExistingFile.id);
    } else {
      setIntent("project");
      if (versionCandidates[0]) {
        setVersionNodeId(versionCandidates[0].id);
      }
    }
    setDestinationFolderId(currentFolderId);
    if (activeTaskId) {
      setSelectedTaskId(activeTaskId);
    }
  }, [matchingExistingFile, currentFolderId, activeTaskId, versionCandidates]);

  // Query project tasks when task search query changes or when opening task intents
  useEffect(() => {
    if (!isOpen || activeTaskId) return;
    if (intent !== "reference" && intent !== "working" && intent !== "deliverable")
      return;

    let cancelled = false;
    setLoadingTasks(true);

    import("@/app/actions/files/links")
      .then(({ searchProjectTasks }) =>
        searchProjectTasks(projectId, taskQuery, 20),
      )
      .then((tasks) => {
        if (!cancelled) {
          setTaskResults(tasks);
          if (!selectedTaskId && tasks.length > 0 && tasks[0]) {
            setSelectedTaskId(tasks[0].id);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setTaskResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, taskQuery, intent, activeTaskId, selectedTaskId]);

  const displayName =
    fileCount === 1 && singleFile ? singleFile.name : `${fileCount} files`;

  const handleConfirm = () => {
    if (intent === "version") {
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        versionNodeId: versionNodeId || matchingExistingFile?.id || undefined,
      });
    } else if (intent === "project") {
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
      });
    } else {
      // Task categories (reference, working, deliverable)
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        taskId: activeTaskId || selectedTaskId || undefined,
        label: label.trim() || undefined,
        role: intent as TaskFileRole,
      });
    }
  };

  const isTaskCategory =
    intent === "reference" || intent === "working" || intent === "deliverable";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onCancel()}>
      <DialogContent className="z-[300] sm:max-w-lg max-h-[90vh] overflow-y-auto" overlayClassName="z-[299]">
        <DialogHeader>
          <DialogTitle className="truncate pr-4">Upload {displayName}</DialogTitle>
          <DialogDescription>
            How would you like to categorize these files?
          </DialogDescription>
        </DialogHeader>

        {/* Existing file collision banner */}
        {matchingExistingFile && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">Matching file detected: </span>
              <span className="font-mono">{matchingExistingFile.name}</span>
              <p className="mt-0.5 text-amber-700/90 dark:text-amber-300/90">
                You can save this upload directly as a new version or choose to place it as a separate project file.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5 py-2">
          {/* Option 1: Project Files */}
          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors cursor-pointer",
              intent === "project"
                ? "border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
            onClick={() => setIntent("project")}
          >
            <div className="flex w-full items-start gap-3 text-left">
              <FolderUp
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  intent === "project"
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Project Files
                  </div>
                  {intent === "project" && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-500">
                      <Check className="size-2.5" />
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Place among existing files in {currentFolderName}.
                </div>
              </div>
            </div>

            {intent === "project" && (
              <div className="mt-3 pl-8">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFolderPicker((prev) => !prev);
                  }}
                  className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 flex items-center gap-1"
                >
                  {showFolderPicker ? "Keep in current folder" : "Change destination folder…"}
                </button>
                {showFolderPicker && (
                  <div className="mt-2 max-h-[160px] overflow-y-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950 p-1">
                    <FolderPicker
                      projectId={projectId}
                      selectedFolderId={destinationFolderId}
                      onSelectFolder={(id) => setDestinationFolderId(id)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Option 2: Task Reference */}
          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors cursor-pointer",
              intent === "reference"
                ? "border-sky-600 bg-sky-50/50 dark:border-sky-500 dark:bg-sky-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
            onClick={() => setIntent("reference")}
          >
            <div className="flex w-full items-start gap-3 text-left">
              <BookOpen
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  intent === "reference"
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Task Reference
                  </div>
                  {intent === "reference" && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-sky-600 text-white dark:bg-sky-500">
                      <Check className="size-2.5" />
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  A brief, specification, example, or source file supplied as task input.
                </div>
              </div>
            </div>
          </div>

          {/* Option 3: Working File */}
          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors cursor-pointer",
              intent === "working"
                ? "border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
            onClick={() => setIntent("working")}
          >
            <div className="flex w-full items-start gap-3 text-left">
              <FolderDown
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  intent === "working"
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Working File
                  </div>
                  {intent === "working" && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-500">
                      <Check className="size-2.5" />
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Active drafts and intermediate work produced while completing the task.
                </div>
              </div>
            </div>

            {intent === "working" && (
              <div className="mt-3 pl-8">
                <input
                  type="text"
                  placeholder="Optional description or tag…"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400"
                />
              </div>
            )}
          </div>

          {/* Option 4: Final Deliverable */}
          <div
            className={cn(
              "flex flex-col rounded-lg border p-3 transition-colors cursor-pointer",
              intent === "deliverable"
                ? "border-emerald-600 bg-emerald-50/50 dark:border-emerald-500 dark:bg-emerald-500/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
            )}
            onClick={() => setIntent("deliverable")}
          >
            <div className="flex w-full items-start gap-3 text-left">
              <FolderUp
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  intent === "deliverable"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-400",
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Final Deliverable
                  </div>
                  {intent === "deliverable" && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
                      <Check className="size-2.5" />
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  The completed output of this task. Optionally choose its project folder.
                </div>
              </div>
            </div>

            {intent === "deliverable" && (
              <div className="mt-3 pl-8 max-h-[160px] overflow-y-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950 p-1">
                <FolderPicker
                  projectId={projectId}
                  selectedFolderId={destinationFolderId}
                  onSelectFolder={setDestinationFolderId}
                />
              </div>
            )}
          </div>

          {/* Option 5: New Version of Existing File */}
          {singleFile && versionCandidates.length > 0 && (
            <div
              className={cn(
                "flex flex-col rounded-lg border p-3 transition-colors cursor-pointer",
                intent === "version"
                  ? "border-amber-600 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-500/10"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
              )}
              onClick={() => {
                setIntent("version");
                if (!versionNodeId && versionCandidates[0]) {
                  setVersionNodeId(versionCandidates[0].id);
                }
              }}
            >
              <div className="flex w-full items-start gap-3 text-left">
                <RefreshCcw
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    intent === "version"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-400",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      New Version of Existing File
                    </div>
                    {intent === "version" && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-amber-600 text-white dark:bg-amber-500">
                        <Check className="size-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Add this upload to an existing file&apos;s version history.
                  </div>
                </div>
              </div>

              {intent === "version" && (
                <div className="mt-3 pl-8" onClick={(e) => e.stopPropagation()}>
                  <label htmlFor="files-tab-version-target" className="sr-only">
                    Existing file
                  </label>
                  <select
                    id="files-tab-version-target"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    value={versionNodeId}
                    onChange={(e) => setVersionNodeId(e.target.value)}
                  >
                    {versionCandidates.map((cand) => (
                      <option key={cand.id} value={cand.id}>
                        {cand.name} (v{cand.currentVersion || 1})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Task Selector when picking a task category outside a specific task view */}
          {isTaskCategory && (
            <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Associated Task
                </span>
                {activeTaskTitle && (
                  <span className="text-[11px] text-zinc-500 truncate max-w-[200px]">
                    {activeTaskTitle}
                  </span>
                )}
              </div>

              {!activeTaskId && (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 size-3.5 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search project tasks to link…"
                      value={taskQuery}
                      onChange={(e) => setTaskQuery(e.target.value)}
                      className="w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                    {loadingTasks && (
                      <Loader2 className="absolute right-2.5 top-2 size-3.5 animate-spin text-zinc-400" />
                    )}
                  </div>
                  {taskResults.length > 0 && (
                    <select
                      value={selectedTaskId}
                      onChange={(e) => setSelectedTaskId(e.target.value)}
                      className="w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      {taskResults.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.projectKey ? `${t.projectKey}-${t.taskNumber}: ` : ""}
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              isProcessing ||
              (intent === "version" && !versionNodeId) ||
              (isTaskCategory && !activeTaskId && !selectedTaskId)
            }
            onClick={handleConfirm}
            className="rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 px-5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isProcessing && <Loader2 className="size-3.5 animate-spin" />}
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
