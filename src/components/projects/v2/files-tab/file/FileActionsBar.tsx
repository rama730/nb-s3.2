// Task 6.3: Files tab file actions bar (Raw / Edit / Download).
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
import { Download, FileCode2, Link2, ListTodo, Pencil, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import { linkNodeToTask } from "@/app/actions/files";
import { logger } from "@/lib/logger";
import { useFileVersions, type LockConflictInfo } from "@/hooks/useFileVersions";

import { FilesTabRoleContext } from "../FilesTabRoleContext";
import { TaskSearchPicker } from "../picker/TaskSearchPicker";

export interface FileActionsBarProps {
  onRaw: () => void;
  onEdit: () => void;
  onDownload: () => void;
  /** Callback to toggle the LinkedTasksPanel open/closed (Req 8.1). */
  onToggleLinkedTasks?: () => void;
  /** Whether the LinkedTasksPanel is currently open (drives toggle visual state). */
  isLinkedTasksPanelOpen?: boolean;
  /** Project ID — required for "Attach to task…" and "Replace…" actions. */
  projectId?: string;
  /** Node ID — required for "Attach to task…" and "Replace…" actions. */
  nodeId?: string;
  className?: string;
}

export function FileActionsBar({
  onRaw,
  onEdit,
  onDownload,
  onToggleLinkedTasks,
  isLinkedTasksPanelOpen = false,
  projectId,
  nodeId,
  className,
}: FileActionsBarProps): React.JSX.Element {
  const roleCtx = React.useContext(FilesTabRoleContext);
  // Default to read-only when no provider is mounted so the Edit control
  // stays hidden rather than defaulting to a mutation-capable state.
  const canEdit = roleCtx?.canEdit ?? false;

  const { showToast } = useToast();
  const [isTaskPickerOpen, setIsTaskPickerOpen] = React.useState(false);
  const [isLinking, setIsLinking] = React.useState(false);

  // ── Replace… state (Req 11.1–11.6) ──────────────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isReplacing, setIsReplacing] = React.useState(false);
  const [lockConflict, setLockConflict] = React.useState<LockConflictInfo | null>(null);

  const { saveAsNewVersion } = useFileVersions(
    projectId ?? "",
    nodeId ?? "",
  );

  // "Attach to task…" is only available when projectId and nodeId are provided
  // and the user has edit permissions (Req 9.1, 9.2, 24.1).
  const canAttachToTask = canEdit && Boolean(projectId) && Boolean(nodeId);

  // "Replace…" is only available when projectId and nodeId are provided
  // and the user has edit permissions (Req 11.1, 11.2, 24.1).
  const canReplace = canEdit && Boolean(projectId) && Boolean(nodeId);

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

      setIsReplacing(true);
      setLockConflict(null);

      try {
        const result = await saveAsNewVersion(file);

        if (result.success) {
          // On success: MetadataStrip updates via realtime patchNodeVersion (Req 11.6).
          showToast("File replaced successfully", "success");

          // Emit telemetry (Req 16.3).
          logger.metric("files_tab.version_replaced", {
            module: "files-tab",
            source: "files_tab",
            projectId,
            nodeId,
            newVersion: result.version.version,
          });
        } else if (result.lockConflict) {
          // On lock conflict: display indicator, disable Replace button (Req 5.2, 11.5).
          setLockConflict(result.lockConflict);
        } else {
          showToast(result.error || "Failed to replace file", "error");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to replace file";
        showToast(message, "error");
      } finally {
        setIsReplacing(false);
      }
    },
    [projectId, nodeId, saveAsNewVersion, showToast],
  );

  return (
    <div
      data-testid="files-tab-file-actions-bar"
      className={cn("flex items-center gap-1", className)}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRaw}
        data-testid="files-tab-file-actions-raw"
      >
        <FileCode2 aria-hidden="true" />
        Raw
      </Button>
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEdit}
          data-testid="files-tab-file-actions-edit"
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDownload}
        data-testid="files-tab-file-actions-download"
      >
        <Download aria-hidden="true" />
        Download
      </Button>
      {/* "Replace…" — hidden for Role_Viewer (Req 11.2, 24.1) */}
      {canReplace && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReplaceClick}
            disabled={isReplacing || lockConflict !== null}
            aria-label="Replace file with new version"
            data-testid="files-tab-file-actions-replace"
          >
            <RefreshCw aria-hidden="true" className={cn(isReplacing && "animate-spin")} />
            Replace…
          </Button>
          {/* Hidden native file input for single file selection (Req 11.3) */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelected}
            aria-hidden="true"
            tabIndex={-1}
            data-testid="files-tab-file-actions-replace-input"
          />
        </>
      )}
      {/* Lock conflict indicator (Req 5.2, 11.5) */}
      {lockConflict && (
        <span
          className="ml-1 text-xs text-amber-600 dark:text-amber-400"
          data-testid="files-tab-file-actions-lock-indicator"
          role="status"
        >
          Locked by {lockConflict.lockedBy.displayName}
        </span>
      )}
      {/* "Attach to task…" — hidden for Role_Viewer (Req 9.2, 24.1) */}
      {canAttachToTask && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleOpenTaskPicker}
          disabled={isLinking}
          aria-label="Attach to task"
          data-testid="files-tab-file-actions-attach-to-task"
        >
          <Link2 aria-hidden="true" />
          Attach to task…
        </Button>
      )}
      {/* LinkedTasksPanel toggle — visible to ALL roles (Req 8.6) */}
      {onToggleLinkedTasks && (
        <Button
          type="button"
          variant={isLinkedTasksPanelOpen ? "secondary" : "outline"}
          size="sm"
          onClick={onToggleLinkedTasks}
          aria-pressed={isLinkedTasksPanelOpen}
          aria-label="Toggle linked tasks panel"
          data-testid="files-tab-file-actions-linked-tasks-toggle"
        >
          <ListTodo aria-hidden="true" />
          Tasks
        </Button>
      )}

      {/* TaskSearchPicker dialog — rendered when "Attach to task…" is clicked */}
      {canAttachToTask && projectId && (
        <TaskSearchPicker
          projectId={projectId}
          isOpen={isTaskPickerOpen}
          onClose={handleCloseTaskPicker}
          onSelect={handleTaskSelect}
        />
      )}
    </div>
  );
}

export default FileActionsBar;
