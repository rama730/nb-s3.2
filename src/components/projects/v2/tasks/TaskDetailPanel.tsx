"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { X, ChevronRight, CheckSquare, MessageCircle, Paperclip, Activity, CheckCircle2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTaskCounts } from "@/hooks/useTaskCounts";
import { deleteTaskAction } from "@/app/actions/project";
import TaskStatusBadge from "./badges/TaskStatusBadge";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import { formatTaskId } from "@/lib/project-key";
import DetailsTab from "./TaskDetailTabs/DetailsTab";
import SubtasksTab from "./TaskDetailTabs/SubtasksTab";
import CommentsTab from "./TaskDetailTabs/CommentsTab";
import FilesTab from "./TaskDetailTabs/FilesTab";
import ActivityTab from "./TaskDetailTabs/ActivityTab";

interface TaskDetailPanelProps {
    task: any;
    onClose: () => void;
    isOwnerOrMember: boolean;
    isOwner?: boolean;
    sprints?: any[];
    members?: any[];
    projectId: string;
    currentUserId?: string;
}

export default function TaskDetailPanel({ 
    task, 
    onClose, 
    isOwnerOrMember,
    isOwner = false, 
    sprints = [],
    members = [],
    projectId,
    currentUserId
}: TaskDetailPanelProps) {
    const [activeTab, setActiveTab] = useState<"details" | "subtasks" | "comments" | "files" | "activity">("details");
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const taskId = task?.id ?? "";
    
    const { counts } = useTaskCounts(taskId);

    const confirmDeleteTask = useCallback(async () => {
        setDeleteError(null);
        setIsDeleting(true);
        try {
            const result = await deleteTaskAction(task?.id ?? "", projectId);
            if (result.success) {
                onClose();
            } else {
                setDeleteError(result.error || "Failed to delete task");
                setIsDeleting(false);
            }
        } catch (error) {
            console.error("Error deleting task:", error);
            setDeleteError("An error occurred while deleting the task");
            setIsDeleting(false);
        }
    }, [task, projectId, onClose]);

    if (!task) return null;

    const handleDeleteTask = () => {
        setDeleteError(null);
        setShowDeleteConfirm(true);
    };

    return (
        <>
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed top-[var(--header-height,64px)] left-0 right-0 bottom-0 bg-black/50 backdrop-blur-sm z-[200]"
                onClick={onClose}
            />

            {/* Panel */}
            <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed right-0 top-[var(--header-height,64px)] bottom-0 w-full max-w-2xl bg-white dark:bg-zinc-900 shadow-2xl z-[201] flex flex-col border-l border-zinc-200 dark:border-zinc-800 lg:w-[42rem] xl:w-[48rem]"
            >
                {/* Header */}
                <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800">
                    {deleteError ? (
                        <div className="mx-6 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                            {deleteError}
                        </div>
                    ) : null}
                    <div className="flex items-center justify-between px-6 py-4">
                        <div className="flex items-center gap-3">
                            <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                                <ChevronRight className="w-5 h-5 text-zinc-500" />
                            </button>
                            <div className="flex items-center gap-3">
                                <p className="text-xs text-zinc-500 font-mono">
                                    {task.taskNumber && task.project?.key 
                                        ? formatTaskId(task.project.key, task.taskNumber) 
                                        : `#${task.id.slice(0, 8)}`}
                                </p>
                                <TaskStatusBadge status={task.status} />
                                <TaskPriorityBadge priority={task.priority} />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isOwner && (
                                <button
                                    onClick={handleDeleteTask}
                                    disabled={isDeleting}
                                    className="p-2 rounded-md hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-600 dark:text-rose-400 transition-colors disabled:opacity-50"
                                    title="Delete task"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                            <button onClick={onClose} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-center gap-6 px-6 pb-0 overflow-x-auto scrollbar-hide">
                        {[
                            { id: "details", label: "Details", icon: CheckSquare },
                            { id: "subtasks", label: "Subtasks", icon: CheckCircle2, count: counts.subtasks },
                            { id: "comments", label: "Comments", icon: MessageCircle, count: counts.comments },
                            { id: "files", label: "Files", icon: Paperclip, count: counts.files },
                            { id: "activity", label: "Activity", icon: Activity },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={cn(
                                    "flex items-center gap-2 pb-3 border-b-2 text-sm font-medium transition-colors whitespace-nowrap",
                                    activeTab === tab.id
                                        ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                        : "border-transparent text-zinc-500 hover:text-zinc-700"
                                )}
                            >
                                <tab.icon className="w-4 h-4" />
                                {tab.label}
                                {tab.count !== undefined && tab.count > 0 && (
                                    <span className={cn(
                                        "px-1.5 py-0.5 rounded-full text-[10px]",
                                        activeTab === tab.id 
                                            ? "bg-indigo-100 text-indigo-700" 
                                            : "bg-zinc-100 text-zinc-600"
                                    )}>
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto relative bg-white dark:bg-zinc-900">
                    {activeTab === "details" && (
                        <DetailsTab task={task} isOwnerOrMember={isOwnerOrMember} sprints={sprints} members={members} projectId={projectId} />
                    )}
                    {activeTab === "subtasks" && (
                        <SubtasksTab taskId={task.id} isOwnerOrMember={isOwnerOrMember} projectId={projectId} />
                    )}
                    {activeTab === "comments" && (
                        <CommentsTab taskId={task.id} isOwnerOrMember={isOwnerOrMember} projectId={projectId} currentUserId={currentUserId} />
                    )}
                    {activeTab === "files" && (
                        <FilesTab taskId={task.id} taskTitle={task.title} isOwnerOrMember={isOwnerOrMember} projectId={projectId} />
                    )}
                    {activeTab === "activity" && (
                        <ActivityTab />
                    )}
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
