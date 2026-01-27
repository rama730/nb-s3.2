"use client";

import React, { useState } from "react";
import { User, Calendar, Flag, Zap, Hash } from "lucide-react";
import { updateTaskFieldAction, updateTaskStatusAction, assignTaskAction } from "@/app/actions/task";

interface DetailsTabProps {
    task: any;
    isOwnerOrMember: boolean;
    sprints?: any[];
    members?: any[];
    projectId: string;
}

export default function DetailsTab({ task, isOwnerOrMember, sprints = [], members = [], projectId }: DetailsTabProps) {
    const [isUpdating, setIsUpdating] = useState(false);

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

    // Filter available sprints
    const availableSprints = sprints.filter(s => {
        if (!s.endDate) return true;
        const endDate = new Date(s.endDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return endDate >= today;
    });

    return (
        <div className="p-6 space-y-6">
            {/* Title */}
            <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-500 uppercase">Title</label>
                <input 
                    type="text"
                    defaultValue={task.title}
                    onBlur={(e) => handleUpdate("title", e.target.value)}
                    disabled={!isOwnerOrMember || isUpdating}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-lg font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-50"
                />
            </div>

            {/* Description */}
            <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-500 uppercase">Description</label>
                <textarea 
                    rows={4}
                    defaultValue={task.description || ""}
                    onBlur={(e) => handleUpdate("description", e.target.value)}
                    disabled={!isOwnerOrMember || isUpdating}
                    placeholder="Add a description..."
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none disabled:opacity-50"
                />
            </div>

            {/* Fields Grid */}
            <div className="grid grid-cols-2 gap-4">
                {/* Status */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase flex items-center gap-2">
                        <Flag className="w-3.5 h-3.5" />
                        Status
                    </label>
                    <select 
                        value={task.status}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        disabled={!isOwnerOrMember || isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                    >
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                    </select>
                </div>

                {/* Priority */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase">Priority</label>
                    <select 
                        value={task.priority}
                        onChange={(e) => handleUpdate("priority", e.target.value)}
                        disabled={!isOwnerOrMember || isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                    </select>
                </div>

                {/* Assignee */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase flex items-center gap-2">
                        <User className="w-3.5 h-3.5" />
                        Assignee
                    </label>
                    <select 
                        value={task.assigned_to || ""}
                        onChange={(e) => handleAssigneeChange(e.target.value)}
                        disabled={!isOwnerOrMember || isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
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

                {/* Due Date */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5" />
                        Due Date
                    </label>
                    <input 
                        type="date"
                        defaultValue={task.due_date ? task.due_date.split('T')[0] : ""}
                        onChange={(e) => handleUpdate("due_date", e.target.value || null)}
                        disabled={!isOwnerOrMember || isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                    />
                </div>

                {/* Sprint */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5" />
                        Sprint
                    </label>
                    <select 
                        value={task.sprint_id || ""}
                        onChange={(e) => handleUpdate("sprint_id", e.target.value || null)}
                        disabled={!isOwnerOrMember || isUpdating}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                    >
                        <option value="">Backlog (no sprint)</option>
                        {availableSprints.map((sprint: any) => (
                            <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                        ))}
                    </select>
                </div>

                {/* Story Points */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase flex items-center gap-2">
                        <Hash className="w-3.5 h-3.5" />
                        Story Points
                    </label>
                    <input 
                        type="number"
                        defaultValue={task.story_points || ""}
                        onBlur={(e) => handleUpdate("story_points", e.target.value ? parseInt(e.target.value) : null)}
                        disabled={!isOwnerOrMember || isUpdating}
                        placeholder="-"
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                    />
                </div>
            </div>
        </div>
    );
}
