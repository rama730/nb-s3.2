"use client";

import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { TaskFilesExplorer } from "@/components/projects/v2/tasks/components/TaskFilesExplorer";
import { TaskFilesActionMenu } from "@/components/projects/v2/tasks/components/TaskFilesActionMenu";
import { SingleAttachmentPicker } from "@/components/projects/v2/files-tab/picker/SingleAttachmentPicker";
import { TaskFilesEmptyState } from "@/components/projects/v2/tasks/components/TaskFilesEmptyState";
import { FileVersionHistoryDrawer } from "@/components/projects/v2/tasks/components/FileVersionHistoryDrawer";
import {
  TaskFileUploadModal,
  type UploadIntent,
} from "@/components/projects/v2/tasks/components/TaskFileUploadModal";
import { cn } from "@/lib/utils";
import type { TaskFileRole } from "@/lib/projects/task-file-intelligence";
import {
  extractFoldersFromDataTransfer,
  type DroppedFolder,
} from "@/lib/files/folder-drop";
import { DropZoneOverlay } from "@/components/ui/drop-zone-overlay";

interface FilesTabProps {
  projectId: string;
  projectSlug?: string;
  taskId: string;
  canEdit: boolean;
  canManageFiles?: boolean;
  attachments: (ProjectNode & { annotation?: string | null; tags?: string[] | null })[];
  isLoading: boolean;
  error: string | null;
  isUploading: boolean;
  onUploadFiles: (
    files: File[],
    options?: { annotation?: string; parentId?: string; role?: TaskFileRole },
  ) => Promise<{ success: boolean; error?: string }>;
  onUploadFolders?: (
    folders: DroppedFolder[],
    options?: { role?: TaskFileRole; parentId?: string | null },
  ) => Promise<{ success: boolean; error?: string }>;
  onUnlink: (nodeId: string) => Promise<{ success: boolean; error?: string }>;
  onSaveAsNewVersion?: (
    nodeId: string,
    file: File,
    options?: { comment?: string | null },
  ) => Promise<{ success: boolean; error?: string }>;
  initialFileId?: string | null;
  onFilesChanged?: () => Promise<unknown> | void;
}

export default function FilesTab({
  projectId,
  projectSlug,
  taskId,
  canEdit,
  canManageFiles = false,
  attachments,
  isLoading,
  error,
  isUploading,
  onUploadFiles,
  onUploadFolders,
  onUnlink,
  onSaveAsNewVersion,
  initialFileId = null,
  onFilesChanged,
}: FilesTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [historyNode, setHistoryNode] = useState<ProjectNode | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessingDrop, setIsProcessingDrop] = useState(false);
  const [v3PickerOpen, setV3PickerOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(
    null,
  );
  const [pendingUploadFolders, setPendingUploadFolders] = useState<DroppedFolder[] | null>(null);
  const dragCounterRef = useRef(0);

  // URL state routing for Universal Task File Preview (Ponytail Phase 4)
  const handleOpenFile = useCallback(
    async (node: ProjectNode) => {
      const routeProject =
        projectSlug || pathname?.match(/^\/projects\/([^/]+)/)?.[1] || projectId;
      router.push(
        `/projects/${encodeURIComponent(routeProject)}?tab=files&fileId=${encodeURIComponent(node.id)}`,
      );
    },
    [pathname, projectId, projectSlug, router],
  );

  const handleDroppedFiles = useCallback(
    async (files: File[]) => {
      if (!canEdit || files.length === 0) return;
      setPendingUploadFiles(files);
    },
    [canEdit],
  );

  const handleUploadIntentConfirm = async (
    intent: UploadIntent,
    targetNodeId?: string,
    label?: string,
  ) => {
    if (!pendingUploadFiles && !pendingUploadFolders) return;
    const files = pendingUploadFiles;
    const folders = pendingUploadFolders;

    if (
      intent === "version" &&
      targetNodeId &&
      onSaveAsNewVersion &&
      files?.[0]
    ) {
      setIsProcessingDrop(true);
      try {
        const file = files[0]!;
        const result = await onSaveAsNewVersion(targetNodeId, file);
        if (result.success) {
          toast.success(`Saved ${file.name} as a new version.`);
          setPendingUploadFiles(null);
          setPendingUploadFolders(null);
        } else {
          toast.error(result.error || "Failed to save new version");
        }
      } catch {
        toast.error("Failed to save new version");
      } finally {
        setIsProcessingDrop(false);
      }
      return;
    }

    setIsProcessingDrop(true);
    try {
      const role: TaskFileRole =
        intent === "deliverable"
          ? "deliverable"
          : intent === "reference"
            ? "reference"
            : "working";
      const annotation = intent === "deliverable" ? "#deliverable" : label || undefined;
      const parentId = intent === "deliverable" ? targetNodeId : undefined;
      const results: Array<{ success: boolean; error?: string }> = [];
      if (folders?.length) {
        if (onUploadFolders) {
          results.push(await onUploadFolders(folders, { role, parentId }));
        } else {
          results.push(
            await onUploadFiles(
              folders.flatMap((folder) => folder.files.map((entry) => entry.file)),
              { annotation, parentId, role },
            ),
          );
        }
      }
      if (files?.length) {
        results.push(await onUploadFiles(files, { annotation, parentId, role }));
      }
      const failed = results.find((result) => !result.success);
      if (failed) {
        toast.error(failed.error || "Failed to upload files");
        return;
      }
      setPendingUploadFiles(null);
      setPendingUploadFolders(null);
    } catch {
      toast.error("Failed to upload files");
    } finally {
      setIsProcessingDrop(false);
    }
  };

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
    if (dragCounterRef.current === 0) setIsDragActive(false);
  }, []);

  const handleDropZoneDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragActive(false);

      const dataTransfer = event.dataTransfer;
      void (async () => {
        setIsProcessingDrop(true);
        try {
          const extracted = await extractFoldersFromDataTransfer(dataTransfer);
          if (
            extracted.folders.length === 0 &&
            extracted.looseFiles.length === 0
          ) {
            const files = Array.from(dataTransfer.files || []);
            if (files.length > 0) setPendingUploadFiles(files);
            return;
          }
          if (extracted.folders.length > 0 && onUploadFolders) setPendingUploadFolders(extracted.folders);
          if (extracted.looseFiles.length > 0) {
            setPendingUploadFiles(extracted.looseFiles);
          }
          if (extracted.folders.length > 0 && !onUploadFolders) {
            const flat = extracted.folders.flatMap((folder) =>
              folder.files.map((entry) => entry.file),
            );
            if (flat.length > 0) setPendingUploadFiles(flat);
          }
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not read the dropped files",
          );
        } finally {
          setIsProcessingDrop(false);
        }
      })();
    },
    [canEdit, onUploadFolders],
  );

  const hasAttachments = attachments.length > 0;

  useEffect(() => {
    if (!initialFileId || isLoading) return;
    document
      .querySelector<HTMLElement>(
        `[data-task-file-row][data-node-id="${CSS.escape(initialFileId)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }, [attachments, initialFileId, isLoading]);

  return (
    <div className="flex h-full w-full flex-col min-h-0">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Files
        </h2>
        <div className="shrink-0">
          <TaskFilesActionMenu
            canEdit={canEdit}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickExisting={() => setV3PickerOpen(true)}
            disabled={isUploading || isProcessingDrop}
            variant="primary"
          />
        </div>
      </div>

      <div
        data-testid="task-files-tab-body"
        data-loading={isLoading ? "true" : "false"}
        className={cn(
          "relative flex-1 overflow-y-auto px-4 py-4 min-h-0 transition-all duration-200",
          isDragActive && "bg-indigo-50/30 dark:bg-indigo-500/5",
        )}
        onDragEnter={handleDropZoneDragEnter}
        onDragOver={handleDropZoneDragOver}
        onDragLeave={handleDropZoneDragLeave}
        onDrop={handleDropZoneDrop}
      >
        <DropZoneOverlay visible={isDragActive} />

        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-red-500">
            {error}
          </div>
        ) : !hasAttachments ? (
          <TaskFilesEmptyState
            isDragActive={isDragActive}
            canEdit={canEdit}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickExisting={() => setV3PickerOpen(true)}
          />
        ) : (
          <div className="space-y-6">
            <TaskFilesExplorer
              taskId={taskId}
              projectId={projectId}
              linkedNodes={attachments}
              canEdit={canEdit}
              canManageFiles={canManageFiles}
              onUnlink={onUnlink}
              onOpenFile={handleOpenFile}
              onShowHistory={(node) => setHistoryNode(node)}
              onReplaceWithNewVersion={
                onSaveAsNewVersion
                  ? (node, file) => onSaveAsNewVersion(node.id, file)
                  : undefined
              }
              highlightedNodeId={initialFileId}
              onFilesChanged={onFilesChanged}
            />
          </div>
        )}

        {(isUploading || isProcessingDrop) ? (
          <div role="status" aria-live="polite" className="pointer-events-none sticky bottom-3 mx-auto flex w-fit items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-200">
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            {isUploading ? "Uploading task files…" : "Preparing files…"}
          </div>
        ) : null}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) void handleDroppedFiles(files);
            e.target.value = "";
          }}
        />
        <input
          type="file"
          ref={folderInputRef}
          className="hidden"
          multiple
          /* @ts-expect-error webkitdirectory is non-standard but widely supported */
          webkitdirectory=""
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) {
              const syntheticFolder: DroppedFolder = {
                name: files[0]?.webkitRelativePath.split("/")[0] || "Folder",
                files: files.map((f) => ({
                  file: f,
                  relativePath: f.webkitRelativePath
                    .split("/")
                    .slice(1)
                    .join("/"),
                })),
              };
              if (onUploadFolders) {
                setPendingUploadFolders([syntheticFolder]);
              } else {
                setPendingUploadFiles(files);
              }
            }
            e.target.value = "";
          }}
        />
      </div>

      <SingleAttachmentPicker
        projectId={projectId}
        taskId={taskId}
        isOpen={v3PickerOpen}
        onClose={() => setV3PickerOpen(false)}
        existingAttachments={attachments}
        onLinked={onFilesChanged}
      />

      {historyNode && (
        <FileVersionHistoryDrawer
          open={!!historyNode}
          onOpenChange={(open) => !open && setHistoryNode(null)}
          node={historyNode}
          projectId={projectId}
          canEdit={canEdit}
        />
      )}

      {(pendingUploadFiles || pendingUploadFolders) && (
        <TaskFileUploadModal
          projectId={projectId}
          isOpen={true}
          files={pendingUploadFiles ?? pendingUploadFolders?.flatMap((folder) => folder.files.map((entry) => entry.file)) ?? []}
          folderCount={pendingUploadFolders?.length ?? 0}
          existingFiles={attachments}
          onConfirm={handleUploadIntentConfirm}
          onCancel={() => { setPendingUploadFiles(null); setPendingUploadFolders(null); }}
        />
      )}
    </div>
  );
}
