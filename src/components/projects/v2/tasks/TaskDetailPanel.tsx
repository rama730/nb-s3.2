"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CheckSquare,
  MessageCircle,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";

import { deleteTaskAction, markTaskAsReadAction } from "@/app/actions/project";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { removeTaskFromProjectTaskCaches } from "@/lib/projects/task-cache";
import { formatTaskId } from "@/lib/project-key";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import {
  useTaskPanelResource,
  type TaskPanelTab,
} from "@/hooks/useTaskPanelResource";

import CommentsTab from "./TaskDetailTabs/CommentsTab";
import DetailsTab from "./TaskDetailTabs/DetailsTab";
import FilesTab from "./TaskDetailTabs/FilesTab";
import SubtasksTab from "./TaskDetailTabs/SubtasksTab";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import TaskStatusBadge from "./badges/TaskStatusBadge";

interface TaskDetailPanelProps {
  task: TaskSurfaceRecord | any;
  onClose: () => void;
  onTaskUpdated?: (task: TaskSurfaceRecord) => void;
  canEdit: boolean;
  canManageFiles?: boolean;
  isOwner?: boolean;
  sprints?: any[];
  members?: any[];
  projectId: string;
  projectSlug?: string;
  currentUserId?: string;
  initialTab?: TaskPanelTab | null;
  initialCommentId?: string | null;
  initialFileId?: string | null;
}

export default function TaskDetailPanel({
  task,
  onClose,
  onTaskUpdated,
  canEdit,
  canManageFiles = false,
  isOwner = false,
  sprints = [],
  members = [],
  projectId,
  projectSlug,
  currentUserId,
  initialTab = null,
  initialCommentId = null,
  initialFileId = null,
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TaskPanelTab>(
    initialTab ?? "details",
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRealtimeIssue, setShowRealtimeIssue] = useState(false);
  const readReceiptTaskIdRef = useRef<string | null>(null);

  const normalizedTask = useMemo(
    () => normalizeTaskSurfaceRecord(task),
    [task],
  );
  const resource = useTaskPanelResource({
    task: normalizedTask,
    projectId,
    activeTab,
    currentUserId,
    canEdit,
    sprints,
    members,
    onTaskUpdated,
  });

  useEffect(() => {
    setActiveTab(initialTab ?? "details");
  }, [initialTab, normalizedTask.id]);

  useEffect(() => {
    void resource.ensureTabLoaded(activeTab);
  }, [activeTab, resource.ensureTabLoaded]);

  useEffect(() => {
    if (resource.isRealtimeConnected) {
      setShowRealtimeIssue(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRealtimeIssue(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [resource.isRealtimeConnected]);

  // Ponytail Optimistic Read Receipts
  useEffect(() => {
    if (
      normalizedTask.id &&
      readReceiptTaskIdRef.current !== normalizedTask.id &&
      ((normalizedTask.newSubtaskCount && normalizedTask.newSubtaskCount > 0) ||
        (normalizedTask.newCommentCount &&
          normalizedTask.newCommentCount > 0) ||
        (normalizedTask.newFileCount && normalizedTask.newFileCount > 0))
    ) {
      readReceiptTaskIdRef.current = normalizedTask.id;
      onTaskUpdated?.({
        ...normalizedTask,
        newSubtaskCount: 0,
        newCommentCount: 0,
        newFileCount: 0,
      });
      markTaskAsReadAction(normalizedTask.id).catch((error) => {
        logger.error("Failed to mark task as read in background", { error });
      });
    }
  }, [
    normalizedTask.id,
    normalizedTask.newSubtaskCount,
    normalizedTask.newCommentCount,
    normalizedTask.newFileCount,
    onTaskUpdated,
    normalizedTask,
  ]);

  const tabs = useMemo(
    () => [
      { id: "details" as const, label: "Details", icon: CheckSquare },
      {
        id: "subtasks" as const,
        label: "Subtasks",
        icon: CheckCircle2,
        count: resource.counts.subtasks,
      },
      {
        id: "comments" as const,
        label: "Comments",
        icon: MessageCircle,
        count: resource.counts.comments,
      },
      {
        id: "files" as const,
        label: "Files",
        icon: Paperclip,
        count: resource.counts.files,
      },
    ],
    [resource.counts.comments, resource.counts.files, resource.counts.subtasks],
  );
  const completedSubtaskCount = resource.counts.completedSubtasks;

  const confirmDeleteTask = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const result = await deleteTaskAction(resource.task.id, projectId);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete task");
      }

      removeTaskFromProjectTaskCaches(queryClient, projectId, resource.task.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
      });
      onClose();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "An error occurred while deleting the task",
      );
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          data-testid="task-detail-panel"
          showCloseButton={false}
          overlayClassName="z-[200] bg-zinc-900/40 backdrop-blur-md dark:bg-black/50"
          className="bottom-0 left-auto right-0 top-0 z-[201] flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 border-l border-zinc-200 bg-white p-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:w-[40vw] sm:max-w-[40vw]"
        >
          <DialogTitle className="sr-only">{resource.task.title}</DialogTitle>
          <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800">
            {deleteError ? (
              <div className="mx-6 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                {deleteError}
              </div>
            ) : null}

            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3">
                  <p className="font-mono text-xs text-zinc-500">
                    {resource.task.taskNumber && resource.task.projectKey
                      ? formatTaskId(
                          resource.task.projectKey,
                          resource.task.taskNumber,
                        )
                      : "Task"}
                  </p>
                  <TaskStatusBadge status={resource.task.status} />
                  <TaskPriorityBadge priority={resource.task.priority} />
                  {showRealtimeIssue ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-200">
                      Live updates reconnecting
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isOwner ? (
                  <button
                    onClick={() => {
                      setDeleteError(null);
                      setShowDeleteConfirm(true);
                    }}
                    disabled={isDeleting}
                    aria-label="Delete task"
                    className="rounded-md p-2 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                    title="Delete task"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  onClick={onClose}
                  aria-label="Close task details"
                  className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Task details"
              className="grid w-full grid-cols-4 items-center gap-1 overflow-visible px-3 pb-0 sm:px-4"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  id={`task-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`task-panel-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => {
                    const currentIndex = tabs.findIndex(
                      (candidate) => candidate.id === tab.id,
                    );
                    const direction =
                      event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0;
                    if (!direction) return;
                    event.preventDefault();
                    const next =
                      tabs[(currentIndex + direction + tabs.length) % tabs.length];
                    if (!next) return;
                    setActiveTab(next.id);
                    requestAnimationFrame(() =>
                      document.getElementById(`task-tab-${next.id}`)?.focus(),
                    );
                  }}
                  className={cn(
                    "flex min-w-0 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-1 pb-3 text-xs font-medium transition-colors xl:text-sm",
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  <tab.icon aria-hidden="true" className="h-4 w-4" />
                  <span className="min-w-0 truncate">{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        activeTab === tab.id
                          ? "bg-primary/10 text-primary"
                          : "bg-zinc-100 text-zinc-600",
                      )}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
            {resource.loadedTabs.details ? (
              <div
                id="task-panel-details"
                role="tabpanel"
                aria-labelledby="task-tab-details"
                hidden={activeTab !== "details"}
              >
                <DetailsTab
                  task={resource.task}
                  canEdit={canEdit}
                  canManageSprint={isOwner}
                  isMutating={resource.taskMutations.isMutating}
                  mutationError={resource.taskMutations.mutationError}
                  members={members}
                  sprints={sprints}
                  subtaskCount={resource.counts.subtasks}
                  completedSubtaskCount={completedSubtaskCount}
                  attachmentCount={resource.counts.files}
                  fileWarnings={resource.fileWarnings}
                  fileWarningSummary={resource.fileWarningSummary}
                  onUpdateField={resource.taskMutations.updateField}
                  onUpdateStatus={resource.taskMutations.updateStatus}
                  onUpdateAssignee={resource.taskMutations.updateAssignee}
                  onReviewApproved={(updatedAt) =>
                    onTaskUpdated?.({
                      ...resource.task,
                      reviewStatus: "none",
                      updatedAt,
                    })
                  }
                  onOpenTab={setActiveTab}
                />
              </div>
            ) : null}

            {resource.loadedTabs.subtasks ? (
              <div
                id="task-panel-subtasks"
                role="tabpanel"
                aria-labelledby="task-tab-subtasks"
                hidden={activeTab !== "subtasks"}
              >
                <SubtasksTab
                  subtasks={resource.subtasks}
                  isLoading={resource.loading.subtasks}
                  error={resource.errors.subtasks}
                  canEdit={canEdit}
                  onAddSubtask={resource.addSubtask}
                  onToggleSubtask={resource.toggleSubtask}
                  onDeleteSubtask={resource.removeSubtask}
                  onUpdateSubtask={resource.updateSubtask}
                  onRetry={resource.loadSubtasks}
                />
              </div>
            ) : null}

            {resource.loadedTabs.comments ? (
              <div
                id="task-panel-comments"
                role="tabpanel"
                aria-labelledby="task-tab-comments"
                hidden={activeTab !== "comments"}
              >
                <CommentsTab
                  projectId={projectId}
                  comments={resource.comments}
                  totalCount={resource.counts.comments}
                  hasMore={Boolean(resource.commentNextCursor)}
                  isLoading={resource.loading.comments}
                  isLoadingMore={resource.commentLoadingMore}
                  error={resource.errors.comments}
                  canEdit={canEdit}
                  currentUserId={currentUserId}
                  presenceStatus={resource.discussionPresenceStatus}
                  topLevelTypingUsers={resource.commentTyping.topLevel}
                  replyTypingUsersByParentId={
                    resource.commentTyping.repliesByParentId
                  }
                  onAddComment={resource.addComment}
                  onToggleLike={resource.toggleCommentLike}
                  onDeleteComment={resource.deleteComment}
                  onLoadOlderComments={resource.loadOlderComments}
                  onSendTyping={resource.sendCommentTyping}
                  initialCommentId={initialCommentId}
                />
              </div>
            ) : null}

            {resource.loadedTabs.files ? (
              <div
                id="task-panel-files"
                role="tabpanel"
                aria-labelledby="task-tab-files"
                hidden={activeTab !== "files"}
              >
                <FilesTab
                  projectId={projectId}
                  projectSlug={projectSlug}
                  taskId={resource.task.id}
                  canEdit={canEdit}
                  canManageFiles={canManageFiles}
                  attachments={resource.attachments}
                  isLoading={resource.loading.attachments}
                  error={resource.errors.attachments}
                  isUploading={resource.fileMutations.isUploading}
                  onUploadFiles={resource.fileMutations.uploadFiles}
                  onUploadFolders={async (folders, options) => {
                    const result =
                      await resource.fileMutations.uploadFolders(folders, options);
                    return result.success
                      ? { success: true }
                      : { success: false, error: result.error };
                  }}
                  onUnlink={resource.fileMutations.unlinkAttachment}
                  onFilesChanged={resource.loadAttachments}
                  onSaveAsNewVersion={async (nodeId, file, options) => {
                    const result =
                      await resource.fileMutations.saveAsNewVersion(
                        nodeId,
                        file,
                        options,
                      );
                    if (result.success) {
                      // Emit telemetry (Req 16.3) — version replaced from task panel
                      logger.metric("files_tab.version_replaced", {
                        module: "files-tab",
                        source: "task_panel",
                        projectId,
                        nodeId,
                        newVersion: result.version?.version,
                      });
                      return { success: true };
                    }
                    return { success: false, error: result.error };
                  }}
                  initialFileId={initialFileId}
                />
              </div>
            ) : null}

          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Task"
        description="Are you sure you want to delete this task? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        overlayClassName="z-[300] bg-zinc-950/60"
        contentClassName="z-[301]"
        onConfirm={confirmDeleteTask}
      />
    </>
  );
}
