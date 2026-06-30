// Task 6.3: Files tab file actions bar (Unified context-aware Actions dropdown).
// Task 5.4: Added LinkedTasksPanel toggle button (Req 8.1, 8.6).
// Task 5.5: Added "Attach to task…" action (Req 9.1–9.6, 24.1).
// Task 7.3: Added "Replace…" button (Req 11.1–11.6, 5.2, 16.3, 24.1).
//
// Edit, "Attach to task…", and "Replace…" are hidden entirely when
// role === "Role_Viewer" (Req 5.3-5.4, 9.2, 11.2, 19.3, 24.1).
// The LinkedTasksPanel toggle is visible to ALL roles (Req 8.6).
// Role is read from FilesTabRoleContext. When the context is absent, we
// default to read-only (canEdit=false) so the mutation affordance stays
// hidden — consistent with Req 19.3 ("must not be visible, focusable, or
// activatable" for Role_Viewer). See design.md § FileActionsBar.
"use client";

import * as React from "react";
import {
  BookOpenText,
  FileCode2,
  Link2,
  ListTodo,
  Pencil,
  RefreshCw,
  Settings,
  ChevronDown,
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
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import { logger } from "@/lib/logger";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import {
  useProjectDocDraft,
  PROJECT_DOC_DRAFT_QUERY_KEY,
  PROJECT_DOC_QUERY_KEY,
  useProjectMarkdowns,
  PROJECT_MARKDOWNS_LIST_QUERY_KEY,
} from "@/hooks/hub/useProjectDocData";

import { FilesTabRoleContext } from "../FilesTabRoleContext";
import { TaskSearchPicker } from "../picker/TaskSearchPicker";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { RevisionControlModal } from "@/components/ui/RevisionControlModal";

interface LockConflictInfo {
  lockedBy: { userId: string; displayName: string; lockedAt: string };
}

export interface FileActionsBarProps {
  mode: "view" | "raw" | "edit";
  onView: () => void;
  onRaw: () => void;
  onEdit: () => void;
  onDownload: () => void;
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
  isLinkedDoc?: boolean;
  onNavigateToDoc?: (slug: string) => void;
}

export function FileActionsBar({
  mode,
  onView,
  onRaw,
  onEdit,
  onDownload,
  onToggleLinkedTasks,
  isLinkedTasksPanelOpen = false,
  onToggleVersionHistory,
  isVersionHistoryPanelOpen = false,
  projectId,
  nodeId,
  fileName,
  fileSize = 0,
  mimeType,
  className,
  isLinkedDoc,
  onNavigateToDoc,
}: FileActionsBarProps): React.JSX.Element {
  const roleCtx = React.useContext(FilesTabRoleContext);
  // Default to read-only when no provider is mounted so the Edit control
  // stays hidden rather than defaulting to a mutation-capable state.
  const canEdit = roleCtx?.canEdit ?? false;

  const queryClient = useQueryClient();

  const { data: markdowns = [] } = useProjectMarkdowns(projectId || "");
  const linkedDoc = React.useMemo(() => {
    return markdowns.find((doc: any) => doc.linkedNodeId === nodeId);
  }, [markdowns, nodeId]);
  const isLinked = !!linkedDoc;

  const { showToast } = useToast();
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

  const isTextLike = React.useMemo(() => {
    const name = (fileName || "").toLowerCase();
    const mime = (mimeType || "").toLowerCase();
    if (mime.startsWith("text/")) return true;
    if (mime === "application/json" || mime === "application/xml") return true;
    const ext = name.split(".").pop() || "";
    const textExts = new Set([
      "txt", "md", "markdown", "json", "yml", "yaml", "toml", "xml", "csv",
      "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
      "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "sql", "css",
      "scss", "html", "htm", "sh", "bash", "dockerfile", "gitignore"
    ]);
    return textExts.has(ext);
  }, [fileName, mimeType]);

  const canUseAsReadme = canEdit && Boolean(projectId) && Boolean(nodeId) && isDocLikeFile;

  // Context-aware checks
  const isEmpty = fileSize === 0;
  // If empty, show Raw. Otherwise, show Raw only if it is markdown/readme (normal code is already raw).
  const showRawOption = isEmpty || isDocLikeFile;
  const canEditOption = canEdit && isTextLike && !isEmpty;
  const canReplaceOption = canReplace && !isEmpty;
  const canAttachOption = canAttachToTask && !isEmpty;
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
    async (taskId: string) => {
      if (!nodeId || isLinking) return;

      setIsLinking(true);
      try {
        const { linkNodeToTask } = await import("@/app/actions/files/links");
        await linkNodeToTask(taskId, nodeId);
        // On success: close picker (Req 9.4). TaskLinkChip updates via
        // realtime Project_Channel (Req 9.6).
        setIsTaskPickerOpen(false);
        showToast("File attached to task", "success");
      } catch (err) {
        // On failure: show error toast, keep picker open for retry (Req 9.5).
        const message =
          err instanceof Error ? err.message : "Failed to attach file to task";
        showToast(message, "error");
      } finally {
        setIsLinking(false);
      }
    },
    [nodeId, isLinking, showToast],
  );

  const handleUseAsReadme = React.useCallback(async () => {
    if (!projectId || !nodeId || isImportingReadme) return;
    if (isLinked && linkedDoc) {
      setIsImportingReadme(true);
      try {
        const { unlinkProjectDocAction } = await import("@/app/actions/project/doc");
        const result = await unlinkProjectDocAction(projectId, linkedDoc.slug);
        if (!result.success) {
          showToast(result.error || "Failed to unlink file from Doc", "error");
          return;
        }
        showToast("File unlinked from Doc successfully", "success");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId) }),
          queryClient.invalidateQueries({ queryKey: PROJECT_DOC_DRAFT_QUERY_KEY(projectId, linkedDoc.slug) }),
          queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, linkedDoc.slug) })
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to unlink file";
        showToast(message, "error");
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
        showToast(result.error || "Failed to link file to Doc", "error");
        return;
      }
      showToast("File linked to Doc successfully", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId) }),
        queryClient.invalidateQueries({ queryKey: PROJECT_DOC_DRAFT_QUERY_KEY(projectId, docSlug) }),
        queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, docSlug) })
      ]);
      onNavigateToDoc?.(docSlug);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to link file";
      showToast(message, "error");
    } finally {
      setIsImportingReadme(false);
    }
  }, [isImportingReadme, isLinked, linkedDoc, nodeId, projectId, fileName, queryClient, onNavigateToDoc, showToast]);

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
        showToast(`Extension mismatch: Expected .${expectedExt} but received .${uploadedExt}`, "error");
        return;
      }

      setPendingFile(file);
      setIsModalOpen(true);
    },
    [projectId, nodeId, fileName, showToast]
  );

  const handleRevisionOptionSelected = React.useCallback(
    async (choice: { option: "overwrite" | "commit"; comment?: string }) => {
      if (!pendingFile || !projectId || !nodeId) return;
      const file = pendingFile;
      setPendingFile(null);

      setIsReplacing(true);
      setLockConflict(null);

      try {
        const [{ saveFileAsNewVersion }, { createClient }, { updateProjectFileStats }] = await Promise.all([
          import("@/hooks/useFileVersions"),
          import("@/lib/supabase/client"),
          import("@/app/actions/files/content"),
        ]);
        const supabaseClient = createClient();

        if (choice.option === "commit") {
          // Option B: Commit as New Revision
          const result = await saveFileAsNewVersion({
            projectId,
            nodeId,
            file,
            comment: choice.comment || "Uploaded via Files Tab",
            supabase: supabaseClient,
          });

          if (result.success) {
            showToast("New revision committed successfully", "success");
            // Set node in store
            useFilesWorkspaceStore.getState().setNodes(projectId, [result.node]);

            logger.metric("files_tab.version_replaced", {
              module: "files-tab",
              source: "files_tab",
              projectId,
              nodeId,
              newVersion: result.version.version,
            });
          } else if (result.lockConflict) {
            setLockConflict(result.lockConflict);
          } else {
            showToast(result.error || "Failed to commit revision", "error");
          }
        } else {
          // Option A: Apply to Active Revision
          const node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
          if (!node || !node.s3Key) {
            showToast("Cannot overwrite: Active file has no storage key.", "error");
            return;
          }

          const { error: uploadError } = await supabaseClient.storage
            .from("project-files")
            .update(node.s3Key, file, { upsert: true });

          if (uploadError) throw uploadError;

          const updatedNode = (await updateProjectFileStats(
            projectId,
            nodeId,
            file.size
          )) as any;

          if (updatedNode) {
            useFilesWorkspaceStore.getState().setNodes(projectId, [updatedNode]);
            showToast("Active revision updated in-place", "success");
          } else {
            throw new Error("Failed to update database record stats.");
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to replace file";
        showToast(message, "error");
      } finally {
        setIsReplacing(false);
      }
    },
    [pendingFile, projectId, nodeId, showToast]
  );

  return (
    <div
      data-testid="files-tab-file-actions-bar"
      className={cn("flex items-center gap-2", className)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 font-medium text-xs border-zinc-200 dark:border-zinc-800"
            data-testid="files-tab-file-actions-dropdown-trigger"
          >
            <Settings className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            Actions
            <ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
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
              disabled={isReplacing || lockConflict !== null}
              className="gap-2 cursor-pointer"
              aria-label="Replace file with new version"
            >
              <RefreshCw className={cn("h-4 w-4 opacity-70", isReplacing && "animate-spin")} />
              <span>Replace…</span>
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
          {onToggleLinkedTasks && (
            <DropdownMenuItem
              onClick={onToggleLinkedTasks}
              className={cn("gap-2 cursor-pointer", isLinkedTasksPanelOpen && "bg-zinc-100 dark:bg-zinc-800 font-medium")}
            >
              <ListTodo className="h-4 w-4 opacity-70" />
              <span>Tasks</span>
            </DropdownMenuItem>
          )}

          {onToggleVersionHistory && (
            <DropdownMenuItem
              onClick={onToggleVersionHistory}
              className={cn("gap-2 cursor-pointer", isVersionHistoryPanelOpen && "bg-zinc-100 dark:bg-zinc-800 font-medium")}
            >
              <History className="h-4 w-4 opacity-70" />
              <span>Version history</span>
            </DropdownMenuItem>
          )}
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
