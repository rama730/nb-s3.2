"use client";

import React from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";
import {
    Sparkles,
    ClipboardList,
    Target,
    Users
} from "lucide-react";
import { cn } from "@/lib/utils";

// Sub-panels
import WorkspaceTasksTab from "./WorkspaceTasksTab";
import WorkspaceSprintsTab from "./WorkspaceSprintsTab";
import WorkspaceMembersTab from "./WorkspaceMembersTab";
import WorkspaceNotesTab from "./WorkspaceNotesTab";

export default function WorkspaceOverviewTab() {
    const { profile } = useAuth();
    const { totalPending } = usePeopleNotifications();
    
    // Retrieve counters, defaulting to 0
    const dueToday = (profile as any)?.workspaceDueTodayCount ?? 0;
    const overdue = (profile as any)?.workspaceOverdueCount ?? 0;
    const inProgress = (profile as any)?.workspaceInProgressCount ?? 0;

    const displayName = profile?.fullName || profile?.username || "Developer";

    return (
        <div className="space-y-6 pb-12">
            {/* Header Greeting */}
            <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800/80 pb-2.5">
                <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                        Hello, {displayName}!
                    </h3>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">
                        Personal workspace overview
                    </p>
                </div>
                <Sparkles className="w-4 h-4 text-zinc-400 dark:text-zinc-600 animate-pulse" />
            </div>

            {/* Expandable Notepad at the Top */}
            <div className="space-y-2">
                <WorkspaceNotesTab />
            </div>

            {/* Minimal Metrics Row */}
            <div className="grid grid-cols-4 gap-2 bg-zinc-50 dark:bg-zinc-900/40 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2.5 text-center select-none">
                <div className="flex flex-col items-center justify-center border-r border-zinc-200 dark:border-zinc-800 last:border-none">
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">Due Today</span>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{dueToday}</span>
                </div>
                <div className="flex flex-col items-center justify-center border-r border-zinc-200 dark:border-zinc-800 last:border-none">
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">Overdue</span>
                    <span className={cn("text-xs font-bold mt-0.5", overdue > 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-800 dark:text-zinc-200")}>{overdue}</span>
                </div>
                <div className="flex flex-col items-center justify-center border-r border-zinc-200 dark:border-zinc-800 last:border-none">
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">In Progress</span>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{inProgress}</span>
                </div>
                <div className="flex flex-col items-center justify-center last:border-none">
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">Requests</span>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{totalPending}</span>
                </div>
            </div>

            {/* Clearly Visible Flat Sections */}
            <div className="space-y-6">
                {/* Active Tasks Section */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-1.5">
                        <ClipboardList className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-600" />
                        <h4 className="text-xs font-bold text-zinc-850 dark:text-zinc-200 uppercase tracking-wider">
                            Active Tasks
                        </h4>
                    </div>
                    <WorkspaceTasksTab isActive={true} />
                </div>

                {/* Project Sprints Section */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-1.5">
                        <Target className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-600" />
                        <h4 className="text-xs font-bold text-zinc-850 dark:text-zinc-200 uppercase tracking-wider">
                            Project Sprints
                        </h4>
                    </div>
                    <WorkspaceSprintsTab isActive={true} />
                </div>

                {/* Member Requests Section */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-1.5">
                        <Users className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-600" />
                        <div className="flex items-center justify-between w-full">
                            <h4 className="text-xs font-bold text-zinc-850 dark:text-zinc-200 uppercase tracking-wider">
                                Member Requests
                            </h4>
                            {totalPending > 0 && (
                                <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                    {totalPending} pending
                                </span>
                            )}
                        </div>
                    </div>
                    <WorkspaceMembersTab isActive={true} />
                </div>
            </div>
        </div>
    );
}
