"use client";

import React, { useState } from "react";
import { User, Calendar, Flag, Zap, Clock, Paperclip, CheckSquare, Check } from "lucide-react";
import { updateTaskFieldAction, updateTaskStatusAction, assignTaskAction } from "@/app/actions/task";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useTaskSubtasks } from "@/hooks/useTaskSubtasks";
import { useTaskAttachments } from "@/hooks/useTaskAttachments"; // New Hook
import { toggleSubtaskAction } from "@/app/actions/subtask";
import type { ProjectNode } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/client";

interface DetailsTabProps {
    task: any;
    isOwnerOrMember: boolean;
    sprints?: any[];
    members?: any[];
    projectId: string;
}

export default function DetailsTab({ task, isOwnerOrMember, sprints = [], members = [], projectId }: DetailsTabProps) {
    const [isUpdating, setIsUpdating] = useState(false);
    
    // Unified Data Flow: Hooks subscribe to realtime changes
    const { subtasks } = useTaskSubtasks(task.id);
    const { attachments } = useTaskAttachments(task.id);
    
    const handleUpdate = async (field: string, value: any) => {
        if (!isOwnerOrMember) return;
        setIsUpdating(true);
        try {
            await updateTaskFieldAction(task.id, field, value, projectId);
        } catch (error) {
            console.error("Error updating:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleStatusChange = async (status: string) => {
        if (!isOwnerOrMember) return;
        setIsUpdating(true);
        try {
            await updateTaskStatusAction(task.id, status as any, projectId);
        } catch (error) {
            console.error("Error updating status:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleAssigneeChange = async (assigneeId: string) => {
        if (!isOwnerOrMember) return;
        setIsUpdating(true);
        try {
            await assignTaskAction(task.id, assigneeId || null, projectId);
        } catch (error) {
            console.error("Error assigning:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleToggleSubtask = async (subtaskId: string, completed: boolean) => {
        if (!isOwnerOrMember) return;
        try {
            await toggleSubtaskAction(subtaskId, !completed, projectId);
        } catch (error) {
            console.error("Error toggling subtask:", error);
        }
    };

    const availableSprints = sprints;
    
    // Debug logging for development
    // console.log("DetailsTab members:", members);
    // console.log("DetailsTab sprints:", availableSprints);

    const creatorName = task.creator?.fullName || task.creator?.full_name || "Unknown";
    const creatorAvatar = task.creator?.avatarUrl || task.creator?.avatar_url;

    const supabase = createClient();
    const handleDownload = async (node: ProjectNode) => {
        if (!node.s3Key) return;
        try {
            const { data } = await supabase.storage.from("project-files").createSignedUrl(node.s3Key, 3600);
            if (data?.signedUrl) window.open(data.signedUrl, "_blank");
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    return (
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8 items-start min-h-full">
            {/* Main Content (Left Col) */}
            <div className="lg:col-span-2 space-y-8 min-w-0">
                {/* Header Info */}
                <div className="space-y-4">
                    <input 
                        type="text"
                        defaultValue={task.title}
                        onBlur={(e) => handleUpdate("title", e.target.value)}
                        disabled={!isOwnerOrMember || isUpdating}
                        className="w-full bg-transparent text-2xl font-bold text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 border-none p-0 focus:ring-0 transition-colors"
                        placeholder="Task Title"
                    />
                    
                    {/* Creator Metadata - Using simple flex for Safari safety */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <div className="inline-flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700">
                            <span className="text-zinc-400">Created by</span>
                            <div className="flex items-center gap-1.5">
                                <Avatar className="w-4 h-4">
                                    <AvatarImage src={creatorAvatar} />
                                    <AvatarFallback>{creatorName.substring(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <span className="font-medium text-zinc-900 dark:text-zinc-200 truncate max-w-[120px]">
                                    {creatorName}
                                </span>
                            </div>
                        </div>
                        <span className="text-zinc-300 dark:text-zinc-700">•</span>
                        <div className="inline-flex items-center gap-1.5">
                             <Clock className="w-3.5 h-3.5 text-zinc-400" />
                             <span>{format(new Date(task.createdAt || task.created_at || new Date()), "MMM d, yyyy h:mm a")}</span>
                        </div>
                    </div>
                </div>

                {/* Description */}
                <div className="space-y-3">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        Description
                    </label>
                    <textarea 
                        rows={8}
                        defaultValue={task.description || ""}
                        onBlur={(e) => handleUpdate("description", e.target.value)}
                        disabled={!isOwnerOrMember || isUpdating}
                        placeholder="Add a description..."
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none disabled:opacity-50"
                    />
                </div>

                {/* Attachments Summary */}
                {attachments.length > 0 && (
                    <div className="space-y-3">
                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                            <Paperclip className="w-3.5 h-3.5" /> Attachments ({attachments.length})
                        </label>
                        <div className="flex flex-wrap gap-3">
                            {attachments.map(file => (
                                <button 
                                    key={file.id} 
                                    onClick={() => handleDownload(file)}
                                    // Safari: Specific width/height and flex layout
                                    className="group relative w-28 h-24 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:shadow-sm transition-all"
                                >
                                    <Paperclip className="w-6 h-6 text-zinc-400 mb-2 group-hover:text-indigo-500 transition-colors" />
                                    <span className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate w-full px-2 text-center">
                                        {file.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Subtasks Preview */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                            <CheckSquare className="w-3.5 h-3.5" /> Subtasks ({subtasks.filter(t => t.completed).length}/{subtasks.length})
                        </label>
                        {/* Progress Bar */}
                        {subtasks.length > 0 && (
                            <div className="w-24 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-indigo-500 transition-all duration-300"
                                    style={{ width: `${(subtasks.filter(t => t.completed).length / subtasks.length) * 100}%` }}
                                />
                            </div>
                        )}
                    </div>
                    
                    {subtasks.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-4 text-center">
                             <p className="text-sm text-zinc-400">No subtasks yet. Add them in the Subtasks tab.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {subtasks.map(st => (
                                <div key={st.id} className="flex items-start gap-3 group p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                                    <button
                                        onClick={() => handleToggleSubtask(st.id, st.completed)}
                                        disabled={!isOwnerOrMember}
                                        className={cn(
                                            "flex-shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                            st.completed
                                                ? "bg-indigo-600 border-indigo-600"
                                                : "border-zinc-300 dark:border-zinc-600 hover:border-indigo-600",
                                            !isOwnerOrMember && "cursor-not-allowed opacity-50"
                                        )}
                                    >
                                        {st.completed && <Check className="w-3 h-3 text-white" />}
                                    </button>
                                    <span className={cn(
                                        "text-sm leading-tight transition-all",
                                        st.completed ? "line-through text-zinc-400" : "text-zinc-700 dark:text-zinc-300"
                                    )}>
                                        {st.title}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar Properties (Right Col) */}
            {/* Safari Fix: Use flex-col and ensure width is handled */}
            <div className="space-y-6 w-full lg:w-auto">
                <div className="sticky top-6 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-6">
                    <div className="flex items-center gap-2 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                        <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">Properties</h3>
                    </div>

                    {/* Status */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-2">
                            <Flag className="w-3 h-3" /> Status
                        </label>
                        <select 
                            value={task.status}
                            onChange={(e) => handleStatusChange(e.target.value)}
                            disabled={!isOwnerOrMember || isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 capitalize"
                        >
                            <option value="todo">To Do</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                        </select>
                    </div>

                    {/* Priority */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-zinc-500 uppercase">Priority</label>
                        <select 
                            value={task.priority}
                            onChange={(e) => handleUpdate("priority", e.target.value)}
                            disabled={!isOwnerOrMember || isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 capitalize"
                        >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>

                    {/* Assignee */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-2">
                            <User className="w-3 h-3" /> Assignee
                        </label>
                        <select 
                            value={task.assigneeId || ""}
                            onChange={(e) => handleAssigneeChange(e.target.value)}
                            disabled={!isOwnerOrMember || isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        >
                            <option value="">Unassigned</option>
                            {members
                                .filter((member: any) => member && (member.user_id || member.id))
                                .map((member: any) => (
                                    <option key={member.user_id || member.id} value={member.user_id || member.id}>
                                        {member.user?.full_name || member.user?.username || member.full_name || member.username || "Unknown"}
                                    </option>
                                ))}
                        </select>
                    </div>

                    {/* Sprint */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-2">
                            <Zap className="w-3 h-3" /> Sprint
                        </label>
                        <select 
                            value={task.sprintId || ""}
                            onChange={(e) => handleUpdate("sprintId", e.target.value || null)}
                            disabled={!isOwnerOrMember || isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        >
                            <option value="">Backlog (No Sprint)</option>
                            {availableSprints.map((sprint: any) => (
                                <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                            ))}
                        </select>
                    </div>
                    
                    {/* Due Date */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-zinc-500 uppercase flex items-center gap-2">
                            <Calendar className="w-3 h-3" /> Due Date
                        </label>
                        <input 
                            type="date"
                            defaultValue={task.dueDate ? task.dueDate.split('T')[0] : ""}
                            onChange={(e) => handleUpdate("dueDate", e.target.value || null)}
                            disabled={!isOwnerOrMember || isUpdating}
                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        />
                    </div>


                </div>
            </div>
        </div>
    );
}
