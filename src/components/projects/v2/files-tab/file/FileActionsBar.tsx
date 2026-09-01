// File actions: role-gated edit/replace/task/doc actions plus read-only panel toggles.
"use client";

import { toast } from "sonner";

import * as React from "react";
import {
  BookOpenText,
  FileCode2,
  Link2,
  ListTodo,
  Pencil,
  FileUp,
  MoreHorizontal,
  Download,
  Copy,
  Info,
  History,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isTextLike as isTextFile } from "../../utils/fileKind";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import {
  PROJECT_DOC_QUERY_KEY,
  PROJECT_MARKDOWNS_LIST_QUERY_KEY,
} from "@/hooks/hub/useProjectDocData";

import { FilesTabRoleContext } from "../FilesTabRoleContext";
import { useFilesWorkspaceView } from "../FilesWorkspaceViews";
import { TaskSearchPicker } from "../picker/TaskSearchPicker";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { RevisionControlModal } from "@/components/ui/RevisionControlModal";
import { Star, FolderInput, Trash2 } from "lucide-react";
import { isInternalTaskWorkingFilesNode } from "@/lib/files/task-working-files";

interface LockConflictInfo {
  lockedBy: { userId: string; displayName: string; lockedAt: string };
}

export interface FileActionsBarProps {
  mode: "view" | "raw" | "edit";
  onView: () => void;
  onRaw: () => void;
  onEdit: () => void;
  /** Callback to toggle the LinkedTasksPanel open/closed (Req 8.1). */
  onToggleLinkedTasks?: () => void;
  /** Whether the LinkedTasksPanel is currently open (drives toggle visual state). */
  isLinkedTasksPanelOpen?: boolean;
  /** Callback to toggle the FileVersionHistoryPanel open/closed (Req 10.1, 10.2). */
  onToggleVersionHistory?: () => void;
  /** Whether the FileVersionHistoryPanel is currently open (Req 10.2). */
  isVersionHistoryPanelOpen?: boolean;
  /** Project ID — required for "Attach to task…" and "Replace…" actions. */
  projectId?: string;
  /** Node ID — required for "Attach to task…" and "Replace…" actions. */
  nodeId?: string;
  fileName?: string;
  fileSize?: number | null;
  mimeType?: string | null;
  className?: string;
  linkedDoc?: { slug: string; linkedNodeId?: string | null } | null;
  onNavigateToDoc?: (slug: string) => void;
  actionsTriggerRef?: React.Ref<HTMLButtonElement>;
  organizationActions?: { rename: () => void; move?: () => void; trash: () => void };
}

export function FileActionsBar({
  mode,
  onView,
  onRaw,
  onEdit,
  onToggleLinkedTasks,
  isLinkedTasksPanelOpen = false,
  onToggleVersionHistory,
  isVersionHistoryPanelOpen = false,
  projectId,
  nodeId,
  fileName,
  fileSize = null,
  mimeType,
  className,
  linkedDoc = null,
  onNavigateToDoc,
  actionsTriggerRef,
  organizationActions,
}: FileActionsBarProps): React.JSX.Element {
  const roleCtx = React.useContext(FilesTabRoleContext);
  const workspace = useFilesWorkspaceView();
  // Default to read-only when no provider is mounted so the Edit control
  // stays hidden rather than defaulting to a mutation-capable state.
  const canEdit = roleCtx?.canEdit ?? false;
  const node = useFilesWorkspaceStore(state => projectId && nodeId ? state.byProjectId[projectId]?.nodesById[nodeId] : undefined);
  const canOrganize = organizationActions && canEdit && node && !isInternalTaskWorkingFilesNode(node) && !node.deletedAt && mode !== "edit";
  const starred = useFilesWorkspaceStore(state => !!(projectId && nodeId && state.byProjectId[projectId]?.favorites[nodeId]));

  const queryClient = useQueryClient();

  const isLinked = !!linkedDoc;
  const [isTaskPickerOpen, setIsTaskPickerOpen] = React.useState(false);
  const [isLinking, setIsLinking] = React.useState(false);
  const [isImportingReadme, setIsImportingReadme] = React.useState(false);

  // ── Replace… state (Req 11.1–11.6) ──────────────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isReplacing, setIsReplacing] = React.useState(false);
  const [lockConflict, setLockConflict] = React.useState<LockConflictInfo | null>(null);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  // "Attach to task…" is only available when projectId and nodeId are provided
  // and the user has edit permissions (Req 9.1, 9.2, 24.1).
  const canAttachToTask = canEdit && Boolean(projectId) && Boolean(nodeId);

  // "Replace…" is only available when projectId and nodeId are provided
  // and the user has edit permissions (Req 11.1, 11.2, 24.1).
  const canReplace = canEdit && Boolean(projectId) && Boolean(nodeId);

  const isDocLikeFile = React.useMemo(() => {
    const name = (fileName || "").toLowerCase();
    const mime = (mimeType || "").toLowerCase();
    return (
      /\.(md|mdx|markdown|mdown)$/i.test(name) ||
      /^readme(\.|$)/i.test(name) ||
      mime.includes("markdown") ||
      mime === "text/x-markdown" ||
      mime === "text/markdown"
    );
  }, [fileName, mimeType]);

  const isTextLike = isTextFile({ type: "file", name: fileName || "", mimeType: mimeType ?? null });

  const canUseAsReadme = canEdit && Boolean(projectId) && Boolean(nodeId) && isDocLikeFile;

  // Context-aware checks
  const isEmpty = fileSize === 0;
  // If empty, show Raw. Otherwise, show Raw only if it is markdown/readme (normal code is already raw).
  const showRawOption = isEmpty || isDocLikeFile;
  const canEditOption = canEdit && isTextLike;
  const canReplaceOption = canReplace;
  const canAttachOption = canAttachToTask;
  const canReadmeOption = (canUseAsReadme || isLinked) && !isEmpty;

  const handleOpenTaskPicker = React.useCallback(() => {
    setIsTaskPickerOpen(true);
  }, []);

  const handleCloseTaskPicker = React.useCallback(() => {
    if (!isLinking) {
      setIsTaskPickerOpen(false);
    }
  }, [isLinking]);

  const handleTaskSelect = React.useCallback(
    async (taskId: string, role: "reference" | "working" | "deliverable") => {
      if (!nodeId || isLinking) return;

      setIsLinking(true);
      try {
        const { linkNodeToTask } = await import("@/app/actions/files/links");
        await linkNodeToTask(taskId, nodeId, { role });
        // On success: close picker (Req 9.4). TaskLinkChip updates via
        // realtime Project_Channel (Req 9.6).
        setIsTaskPickerOpen(false);
        window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
        toast.success(
          role === "deliverable"
            ? "File attached as a deliverable"
            : role === "working"
              ? "File attached as a working file"
              : "File attached as a reference",
        );
      } catch (err) {
        // On failure: show error toast, keep picker open for retry (Req 9.5).
        const message =
          err instanceof Error ? err.message : "Failed to attach file to task";
        toast.error(message);
      } finally {
        setIsLinking(false);
      }
    },
    [projectId, nodeId, isLinking],
  );

  const handleUseAsReadme = React.useCallback(async () => {
    if (!projectId || !nodeId || isImportingReadme) return;
    if (isLinked && linkedDoc) {
      setIsImportingReadme(true);
      try {
        const { unlinkProjectDocAction } = await import("@/app/actions/project/doc");
        const result = await unlinkProjectDocAction(projectId, linkedDoc.slug);
        if (!result.success) {
          toast.error(result.error || "Failed to unlink file from Doc");
          return;
        }
        toast.success("File unlinked from Doc successfully");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId) }),
          queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, linkedDoc.slug) })
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to unlink file";
        toast.error(message);
      } finally {
        setIsImportingReadme(false);
      }
      return;
    }
    // Else link it
    setIsImportingReadme(true);
    try {
      const filename = fileName || "document.md";
      const docSlug = normalizeProjectDocSlug(filename, "doc");
      const { linkProjectDocAction } = await import("@/app/actions/project/doc");
      const result = await linkProjectDocAction(projectId, nodeId, docSlug);
      if (!result.success) {
        toast.error(result.error || "Failed to link file to Doc");
        return;
      }
      toast.success("File linked to Doc successfully");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId) }),
        queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, docSlug) }),
        queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, docSlug) })
      ]);
      onNavigateToDoc?.(docSlug);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to link file";
      toast.error(message);
    } finally {
      setIsImportingReadme(false);
    }
  }, [isImportingReadme, isLinked, linkedDoc, nodeId, projectId, fileName, queryClient, onNavigateToDoc]);

  // ── Replace… handlers (Req 11.3–11.6) ───────────────────────────────

  const handleReplaceClick = React.useCallback(() => {
    // Open native file picker for single file selection (Req 11.3).
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !projectId || !nodeId) return;

      // Reset the input so the same file can be re-selected if needed.
      event.target.value = "";

      // Enforce file extension type checks
      const expectedExt = extOf(fileName || "");
      const uploadedExt = extOf(file.name);
      if (expectedExt !== uploadedExt) {
        toast.error(`Extension mismatch: Expected .${expectedExt} but received .${uploadedExt}`);
        return;
      }

      setPendingFile(file);
      setIsModalOpen(true);
    },
    [projectId, nodeId, fileName]
  );

  const handleRevisionOptionSelected = React.useCallback(
    async (choice: { option: "overwrite" | "commit"; comment?: string }) => {
      if (!pendingFile || !projectId || !nodeId) return;
      const file = pendingFile;
      setPendingFile(null);

      setIsReplacing(true);
      setLockConflict(null);

      try {
        const [{ saveFileRevision }, { createClient }] = await Promise.all([
          import("@/hooks/useFileVersions"),
          import("@/lib/supabase/client"),
        ]);
        const supabaseClient = createClient();
        const node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
        const result = await saveFileRevision({
          projectId,
          nodeId,
          file,
          mode: choice.option === "commit" ? "new_revision" : "active_revision",
          comment: choice.comment || (choice.option === "commit" ? "Uploaded via Files Tab" : null),
          baseVersion: node?.currentVersion,
          supabase: supabaseClient,
        });

        if (result.success) {
          toast.success(choice.option === "commit"
              ? "New revision committed successfully"
              : "Active revision updated successfully");
          useFilesWorkspaceStore.getState().setNodes(projectId, [result.node]);
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));

          logger.metric("files_tab.version_replaced", {
            module: "files-tab",
            source: "files_tab",
            projectId,
            nodeId,
            revisionMode: choice.option === "commit" ? "new_revision" : "active_revision",
            newVersion: result.version.version,
          });
        } else if (result.lockConflict) {
          setLockConflict(result.lockConflict);
        } else {
          toast.error(result.error || "Failed to save revision");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to replace file";
        toast.error(message);
      } finally {
        setIsReplacing(false);
      }
    },
    [pendingFile, projectId, nodeId]
  );

  const [downloading, setDownloading] = React.useState(false);
  async function downloadFile() {
    if (!projectId || !nodeId || downloading) return;
    setDownloading(true);
    try {
      const { getProjectFileSignedUrl, getProjectFileContent } = await import("@/app/actions/files/content");
      const node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById[nodeId];
      let url: string;
      let local = false;
      if (node?.s3Key) url = (await getProjectFileSignedUrl(projectId, nodeId, 300, true)).url;
      else {
        const content = await getProjectFileContent(projectId, nodeId);
        url = URL.createObjectURL(new Blob([content], { type: mimeType || "text/plain" }));
        local = true;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName || "download";
      anchor.rel = "noopener";
      anchor.click();
      if (local) setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not download file"); }
    finally { setDownloading(false); }
  }
  async function copyLink() {
    if (!nodeId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "files");
    url.searchParams.set("fileId", nodeId);
    ["path", "filesView", "filesTask", "filesRole", "filesQuery", "filesGroupQuery", "filesPanel"].forEach(key => url.searchParams.delete(key));
    try { await navigator.clipboard.writeText(url.toString()); toast.success("File link copied. Recipients still need access."); }
    catch { toast.error("Could not copy the link. Check browser clipboard permissions."); }
  }

  return (
    <div
      data-testid="files-tab-file-actions-bar"
      className={cn("flex shrink-0 items-center gap-2", className)}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={actionsTriggerRef}
            type="button"
            variant="ghost"
            size="sm"
            className="size-11 p-0"
            aria-label={`Actions for ${fileName || "file"}`}
            title="File actions"
            data-testid="files-tab-file-actions-dropdown-trigger"
          >
            <MoreHorizontal className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8} className="w-56 max-w-[calc(100vw-16px)] [&_[role=menuitem]]:min-h-10">
          {workspace && <DropdownMenuItem onSelect={() => workspace.setInspector(current => current === "details" ? null : "details")}><Info className="size-4" />Details</DropdownMenuItem>}
          {projectId && nodeId && <>
            <DropdownMenuItem onSelect={() => useFilesWorkspaceStore.getState().toggleFavorite(projectId, nodeId)}><Star className="size-4" fill={starred ? "currentColor" : "none"} />{starred ? "Unstar" : "Star"}</DropdownMenuItem>
            <DropdownMenuItem disabled={downloading} onClick={() => void downloadFile()} className="gap-2"><Download className="size-4" />{downloading ? "Downloading…" : "Download"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void copyLink()} className="gap-2"><Copy className="size-4" />Copy file link</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>}
          {/* View / Preview option */}
          {mode !== "view" && (
            <DropdownMenuItem onClick={onView} className="gap-2 cursor-pointer">
              <BookOpenText className="h-4 w-4 opacity-70" />
              <span>Preview</span>
            </DropdownMenuItem>
          )}

          {/* Raw option */}
          {showRawOption && mode !== "raw" && (
            <DropdownMenuItem onClick={onRaw} className="gap-2 cursor-pointer">
              <FileCode2 className="h-4 w-4 opacity-70" />
              <span>Raw</span>
            </DropdownMenuItem>
          )}

          {/* Edit option */}
          {canEditOption && mode !== "edit" && (
            <DropdownMenuItem onClick={onEdit} className="gap-2 cursor-pointer">
              <Pencil className="h-4 w-4 opacity-70" />
              <span>Edit</span>
            </DropdownMenuItem>
          )}

          {/* Replace option */}
          {canReplaceOption && (
            <DropdownMenuItem
              onClick={handleReplaceClick}
              disabled={isReplacing || mode === "edit"}
              className="gap-2 cursor-pointer"
              aria-label="Upload a file revision"
            >
              <FileUp className={cn("h-4 w-4 opacity-70", isReplacing && "animate-pulse")} />
              <span>{lockConflict ? "Retry upload revision…" : "Upload revision…"}</span>
            </DropdownMenuItem>
          )}

          {/* Attach to task option */}
          {canAttachOption && (
            <DropdownMenuItem onClick={handleOpenTaskPicker} className="gap-2 cursor-pointer">
              <Link2 className="h-4 w-4 opacity-70" />
              <span>Attach to task…</span>
            </DropdownMenuItem>
          )}

          {/* Use as Doc option */}
          {canReadmeOption && (
            <DropdownMenuItem onClick={handleUseAsReadme} className="gap-2 cursor-pointer">
              <BookOpenText className="h-4 w-4 opacity-70" />
              <span>{isLinked ? "Unlink as Doc" : "Use as Doc"}</span>
            </DropdownMenuItem>
          )}

          {((mode as string) !== "view" || (showRawOption && (mode as string) !== "raw") || (canEditOption && (mode as string) !== "edit") || canReplaceOption || canAttachOption || canReadmeOption) && (
            <DropdownMenuSeparator />
          )}

          {/* Toggle panels */}
          {onToggleLinkedTasks && roleCtx?.canReadTasks && (
            <DropdownMenuItem
              onClick={onToggleLinkedTasks}
              data-testid="linked-tasks-toggle"
              aria-pressed={isLinkedTasksPanelOpen}
              className={cn("gap-2 cursor-pointer", isLinkedTasksPanelOpen && "bg-zinc-100 dark:bg-zinc-800 font-medium")}
            >
              <ListTodo className="h-4 w-4 opacity-70" />
              <span>Linked tasks</span>
            </DropdownMenuItem>
          )}

          {onToggleVersionHistory && (
            <DropdownMenuItem
              onClick={onToggleVersionHistory}
              data-testid="version-history-toggle"
              aria-pressed={isVersionHistoryPanelOpen}
              className={cn("gap-2 cursor-pointer", isVersionHistoryPanelOpen && "bg-zinc-100 dark:bg-zinc-800 font-medium")}
            >
              <History className="h-4 w-4 opacity-70" />
              <span>Version history</span>
            </DropdownMenuItem>
          )}
          {canOrganize && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={organizationActions?.rename}><Pencil className="size-4" />Rename…</DropdownMenuItem>
            {roleCtx?.canManageFiles && organizationActions?.move && <DropdownMenuItem onSelect={organizationActions.move}><FolderInput className="size-4" />Move…</DropdownMenuItem>}
            <DropdownMenuItem className="text-red-600" onSelect={organizationActions?.trash}><Trash2 className="size-4" />Move to Trash</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Lock conflict indicator (Req 5.2, 11.5) */}
      {lockConflict && (
        <span
          className="text-xs text-amber-600 dark:text-amber-400 font-medium"
          data-testid="files-tab-file-actions-lock-indicator"
          role="status"
        >
          Locked by {lockConflict.lockedBy.displayName}
        </span>
      )}

      {/* Hidden native file input for Replace */}
      {canReplace && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelected}
          aria-hidden="true"
          tabIndex={-1}
          data-testid="files-tab-file-actions-replace-input"
        />
      )}

      {/* TaskSearchPicker dialog */}
      {canAttachToTask && projectId && (
        <TaskSearchPicker
          projectId={projectId}
          isOpen={isTaskPickerOpen}
          isSaving={isLinking}
          onClose={handleCloseTaskPicker}
          onSelect={handleTaskSelect}
        />
      )}
      {/* Revision control option picker modal */}
      {isModalOpen && (
        <RevisionControlModal
          isOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          fileName={fileName || "selected file"}
          onSelectOption={handleRevisionOptionSelected}
        />
      )}
    </div>
  );
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx + 1).toLowerCase();
}
export default FileActionsBar;
