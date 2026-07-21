"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Activity, CheckCircle2, CheckSquare, MessageCircle, Paperclip, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTaskPanelResource, type TaskPanelTab } from "@/hooks/useTaskPanelResource";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";
import { formatTaskId } from "@/lib/project-key";
import { cn } from "@/lib/utils";

import DetailsTab from "@/components/projects/v2/tasks/TaskDetailTabs/DetailsTab";
import SubtasksTab from "@/components/projects/v2/tasks/TaskDetailTabs/SubtasksTab";
import CommentsTab from "@/components/projects/v2/tasks/TaskDetailTabs/CommentsTab";
import FilesTab from "@/components/projects/v2/tasks/TaskDetailTabs/FilesTab";
import ActivityTab from "@/components/projects/v2/tasks/TaskDetailTabs/ActivityTab";
import TaskStatusBadge from "@/components/projects/v2/tasks/badges/TaskStatusBadge";
import TaskPriorityBadge from "@/components/projects/v2/tasks/badges/TaskPriorityBadge";

interface WorkspaceTaskDetailViewProps {
    task: any;
    onBack: () => void;
}

export default function WorkspaceTaskDetailView({ task, onBack }: WorkspaceTaskDetailViewProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<TaskPanelTab>("details");

    const normalizedTask = useMemo(() => normalizeTaskSurfaceRecord(task), [task]);
    const projectId = task.projectId || task.project?.id || "";

    const resource = useTaskPanelResource({
        task: normalizedTask,
        projectId,
        currentUserId: user?.id,
        canEdit: true,
        sprints: [],
        members: [],
    });
    const completedSubtaskCount = useMemo(
        () => resource.subtasks.filter((subtask) => subtask.completed).length,
        [resource.subtasks],
    );

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
        [resource.counts.comments, resource.counts.files, resource.counts.subtasks]
    );

    if (!user) return null;

    return (
        <div className="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-950">
            {/* Sub-header bar */}
            <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/80 px-6 py-3 bg-zinc-50/50 dark:bg-zinc-900/10 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors py-1 focus:outline-none"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Back to Workspace
                    </button>
                    {!resource.isRealtimeConnected && (
                        <span className="rounded-full border border-amber-200 bg-amber-50/50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
                            Reconnecting...
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-zinc-400">
                        {resource.task.taskNumber && resource.task.projectKey
                            ? formatTaskId(resource.task.projectKey, resource.task.taskNumber)
                            : `#${resource.task.id.slice(0, 8)}`}
                    </span>
                    <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate max-w-[180px]">
                        {resource.task.title}
                    </h4>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <TaskStatusBadge status={resource.task.status} />
                        <TaskPriorityBadge priority={resource.task.priority} />
                    </div>
                </div>
            </div>

            {/* Tab navigation headers */}
            <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/50 bg-white dark:bg-zinc-950 px-6 flex gap-4 overflow-x-auto scrollbar-hide">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "relative flex items-center gap-1 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap focus:outline-none",
                            activeTab === tab.id
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                        )}
                    >
                        <tab.icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                        {tab.count !== undefined && tab.count > 0 && (
                            <span
                                className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                    activeTab === tab.id
                                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                        : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                                )}
                            >
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Scrollable Tab Panel Container */}
            <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/20 dark:bg-zinc-950/20 relative">
                {activeTab === "details" && resource.loadedTabs.details && (
                    <div>
                        <DetailsTab
                            task={resource.task}
                            canEdit={true}
                            isMutating={resource.taskMutations.isMutating}
                            mutationError={resource.taskMutations.mutationError}
                            members={[]}
                            sprints={[]}
                            subtaskCount={resource.subtasks.length}
                            completedSubtaskCount={completedSubtaskCount}
                            attachmentCount={resource.attachments.length}
                            fileWarnings={resource.fileWarnings}
                            fileWarningSummary={resource.fileWarningSummary}
                            onUpdateField={resource.taskMutations.updateField}
                            onUpdateStatus={resource.taskMutations.updateStatus}
                            onUpdateAssignee={resource.taskMutations.updateAssignee}
                            onOpenTab={setActiveTab}
                        />
                    </div>
                )}

                {activeTab === "subtasks" && resource.loadedTabs.subtasks && (
                    <div>
                        <SubtasksTab
                            subtasks={resource.subtasks}
                            isLoading={resource.loading.subtasks}
                            error={resource.errors.subtasks}
                            canEdit={true}
                            onAddSubtask={resource.addSubtask}
                            onToggleSubtask={resource.toggleSubtask}
                            onDeleteSubtask={resource.removeSubtask}
                        />
                    </div>
                )}

                {activeTab === "comments" && resource.loadedTabs.comments && (
                    <div>
                        <CommentsTab
                            projectId={projectId}
                            comments={resource.comments}
                            totalCount={resource.counts.comments}
                            hasMore={Boolean(resource.commentNextCursor)}
                            isLoading={resource.loading.comments}
                            isLoadingMore={resource.commentLoadingMore}
                            error={resource.errors.comments}
                            canEdit={true}
                            currentUserId={user.id}
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
                )}

                {activeTab === "files" && resource.loadedTabs.files && (
                    <div>
                        <FilesTab
                            projectId={projectId}
                            taskId={resource.task.id}
                            taskTitle={resource.task.title}
                            canEdit={true}
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
                            onUnlink={resource.fileMutations.unlinkAttachment}
                            onOpenFile={resource.fileMutations.downloadAttachment}
                            onResolvePendingResolution={resource.fileMutations.resolvePendingResolution}
                            onSaveAsNewVersion={async (nodeId, file, options) => {
                                const result = await resource.fileMutations.saveAsNewVersion(
                                    nodeId,
                                    file,
                                    options
                                );
                                return result.success
                                    ? { success: true }
                                    : { success: false, error: result.error };
                            }}
                        />
                    </div>
                )}

                {activeTab === "activity" && resource.loadedTabs.activity && (
                    <div>
                        <ActivityTab
                            items={resource.activity}
                            isLoading={resource.loading.activity}
                            error={resource.errors.activity}
                            onRefresh={resource.loadActivity}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
