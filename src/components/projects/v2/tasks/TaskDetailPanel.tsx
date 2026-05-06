"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  MessageCircle,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";

import { deleteTaskAction } from "@/app/actions/project";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { queryKeys } from "@/lib/query-keys";
import { removeTaskFromProjectTaskCaches } from "@/lib/projects/task-cache";
import { formatTaskId } from "@/lib/project-key";
import { cn } from "@/lib/utils";
import { normalizeTaskSurfaceRecord, type TaskSurfaceRecord } from "@/lib/projects/task-presentation";
import { useTaskPanelResource, type TaskPanelTab } from "@/hooks/useTaskPanelResource";

import ActivityTab from "./TaskDetailTabs/ActivityTab";
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
  isOwnerOrMember: boolean;
  isOwner?: boolean;
  sprints?: any[];
  members?: any[];
  projectId: string;
  currentUserId?: string;
  initialTab?: TaskPanelTab | null;
}

export default function TaskDetailPanel({
  task,
  onClose,
  onTaskUpdated,
  isOwnerOrMember,
  isOwner = false,
  sprints = [],
  members = [],
  projectId,
  currentUserId,
  initialTab = null,
}: TaskDetailPanelProps) {
  const reduceMotion = useReducedMotionPreference();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TaskPanelTab>(initialTab ?? "details");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const normalizedTask = useMemo(() => normalizeTaskSurfaceRecord(task), [task]);
  const resource = useTaskPanelResource({
    task: normalizedTask,
    projectId,
    currentUserId,
    canEdit: isOwnerOrMember,
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

  const tabs = useMemo(
    () => [
      { id: "details" as const, label: "Details", icon: CheckSquare },
      { id: "subtasks" as const, label: "Subtasks", icon: CheckCircle2, count: resource.counts.subtasks },
      { id: "comments" as const, label: "Comments", icon: MessageCircle, count: resource.counts.comments },
      { id: "files" as const, label: "Files", icon: Paperclip, count: resource.counts.files },
      { id: "activity" as const, label: "Activity", icon: Activity },
    ],
    [resource.counts.comments, resource.counts.files, resource.counts.subtasks],
  );

  const confirmDeleteTask = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const result = await deleteTaskAction(resource.task.id, projectId);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete task");
      }

      removeTaskFromProjectTaskCaches(queryClient, projectId, resource.task.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      onClose();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "An error occurred while deleting the task");
      setIsDeleting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : undefined}
        className="fixed bottom-0 left-0 right-0 top-[var(--header-height,56px)] z-[200] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { x: "100%" }}
        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 200 }}
        className="fixed bottom-0 right-0 top-[var(--header-height,56px)] z-[201] flex w-full max-w-2xl flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 lg:w-[42rem] xl:w-[48rem]"
      >
        <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800">
          {deleteError ? (
            <div className="mx-6 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
              {deleteError}
            </div>
          ) : null}

          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="rounded-full p-1 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ChevronRight className="h-5 w-5 text-zinc-500" />
              </button>
              <div className="flex items-center gap-3">
                <p className="font-mono text-xs text-zinc-500">
                  {resource.task.taskNumber && resource.task.projectKey
                    ? formatTaskId(resource.task.projectKey, resource.task.taskNumber)
                    : `#${resource.task.id.slice(0, 8)}`}
                </p>
                <TaskStatusBadge status={resource.task.status} />
                <TaskPriorityBadge priority={resource.task.priority} />
                {!resource.isRealtimeConnected ? (
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
                  className="rounded-md p-2 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                  title="Delete task"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
              <button
                onClick={onClose}
                className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="scrollbar-hide flex items-center gap-6 overflow-x-auto px-6 pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {tab.count !== undefined && tab.count > 0 ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-zinc-100 text-zinc-600",
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
            <div className={activeTab === "details" ? "block" : "hidden"}>
              <DetailsTab
                task={resource.task}
                canEdit={isOwnerOrMember}
                isMutating={resource.taskMutations.isMutating}
                mutationError={resource.taskMutations.mutationError}
                members={members}
                sprints={sprints}
                subtasks={resource.subtasks}
                attachments={resource.attachments}
                fileWarnings={resource.fileWarnings}
                fileWarningSummary={resource.fileWarningSummary}
                onUpdateField={resource.taskMutations.updateField}
                onUpdateStatus={resource.taskMutations.updateStatus}
                onUpdateAssignee={resource.taskMutations.updateAssignee}
                onToggleSubtask={resource.toggleSubtask}
                onDownloadAttachment={resource.fileMutations.downloadAttachment}
              />
            </div>
          ) : null}

          {resource.loadedTabs.subtasks ? (
            <div className={activeTab === "subtasks" ? "block" : "hidden"}>
              <SubtasksTab
                subtasks={resource.subtasks}
                isLoading={resource.loading.subtasks}
                error={resource.errors.subtasks}
                canEdit={isOwnerOrMember}
                onAddSubtask={resource.addSubtask}
                onToggleSubtask={resource.toggleSubtask}
                onDeleteSubtask={resource.removeSubtask}
              />
            </div>
          ) : null}

          {resource.loadedTabs.comments ? (
            <div className={activeTab === "comments" ? "block" : "hidden"}>
              <CommentsTab
                projectId={projectId}
                comments={resource.comments}
                totalCount={resource.counts.comments}
                hasMore={Boolean(resource.commentNextCursor)}
                isLoading={resource.loading.comments}
                isLoadingMore={resource.commentLoadingMore}
                error={resource.errors.comments}
                canEdit={isOwnerOrMember}
                currentUserId={currentUserId}
                isPresenceConnected={resource.discussionPresenceConnected}
                topLevelTypingUsers={resource.commentTyping.topLevel}
                replyTypingUsersByParentId={resource.commentTyping.repliesByParentId}
                onAddComment={resource.addComment}
                onToggleLike={resource.toggleCommentLike}
                onDeleteComment={resource.deleteComment}
                onLoadOlderComments={resource.loadOlderComments}
                onSendTyping={resource.sendCommentTyping}
              />
            </div>
          ) : null}

          {resource.loadedTabs.files ? (
            <div className={activeTab === "files" ? "block" : "hidden"}>
              <FilesTab
                projectId={projectId}
                taskId={resource.task.id}
                taskTitle={resource.task.title}
                canEdit={isOwnerOrMember}
                attachments={resource.attachments}
                isLoading={resource.loading.attachments}
                error={resource.errors.attachments}
                uploadQueue={resource.fileMutations.uploadQueue}
                fileWarnings={resource.fileWarnings}
                fileWarningSummary={resource.fileWarningSummary}
                pendingResolution={resource.fileMutations.pendingResolution}
                isUploading={resource.fileMutations.isUploading}
                onUploadFiles={resource.fileMutations.uploadFiles}
                onUploadFolders={async (folders) => {
                  const result = await resource.fileMutations.uploadFolders(folders);
                  return result.success
                    ? { success: true }
                    : { success: false, error: result.error };
                }}
                onAttachExisting={resource.fileMutations.attachExisting}
                onUnlink={resource.fileMutations.unlinkAttachment}
                onOpenFile={resource.fileMutations.downloadAttachment}
                onResolvePendingResolution={resource.fileMutations.resolvePendingResolution}
                onSaveAsNewVersion={async (nodeId, file, options) => {
                  const result = await resource.fileMutations.saveAsNewVersion(
                    nodeId,
                    file,
                    options,
                  );
                  return result.success
                    ? { success: true }
                    : { success: false, error: result.error };
                }}
              />
            </div>
          ) : null}

          {resource.loadedTabs.activity ? (
            <div className={activeTab === "activity" ? "block" : "hidden"}>
              <ActivityTab
                items={resource.activity}
                isLoading={resource.loading.activity}
                error={resource.errors.activity}
                onRefresh={resource.loadActivity}
              />
            </div>
          ) : null}
        </div>
      </motion.div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Task"
        description="Are you sure you want to delete this task? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDeleteTask}
      />
    </>
  );
}
