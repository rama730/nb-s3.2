"use client";

import { Activity, ChevronRight, Layout, Users, Zap } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

interface PulseActivity {
    id: string;
    type: string;
    description?: string;
    created_at: string;
    metadata?: any;
    actor?: { name: string; id?: string } | null;
}

interface ProjectPulseCardProps {
    projectId: string;
    activities: PulseActivity[];
    tasks: any[];
    isCollaborator: boolean;
    isCreator: boolean;
    currentUserId: string | null;
    onViewBoard: () => void;
    onUploadFile: () => void;
    onViewAnalytics: () => void;
    onViewSprints: () => void;
    onViewSettings: () => void;
    onTaskClick: (taskId: string) => void;
    hasMoreActivities?: boolean;
    isLoadingActivities?: boolean;
    onLoadMoreActivities?: () => void;
}

export default function ProjectPulseCard({
    projectId,
    activities,
    tasks,
    isCollaborator,
    isCreator,
    currentUserId,
    onViewBoard,
    onTaskClick,
}: ProjectPulseCardProps) {
    const reduceMotion = useReducedMotionPreference();
    const [activeTab, setActiveTab] = useState<"focus" | "stream" | "team">("focus");

    const myFocusTasks = tasks
        .filter(t => t.assigned_to === currentUserId && t.status !== "done")
        .sort((a, b) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime())
        .slice(0, 5);

    const teamTasks = tasks
        .filter(t => !t.assigned_to && t.status !== "done")
        .slice(0, 5);

    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm min-h-[320px] max-h-[500px] flex flex-col">
            {/* Header & Tabs */}
            <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Project Pulse
                </h3>

                {/* Smart Tabs */}
                <div className="flex gap-1 p-0.5 bg-zinc-100/50 dark:bg-zinc-800/50 rounded-lg">
                    {[
                        { id: "focus", label: "My Focus", count: myFocusTasks.length },
                        { id: "stream", label: "Stream", count: null },
                        { id: "team", label: "Team", count: teamTasks.length }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                                "relative px-2.5 py-1 rounded-md text-[10px] font-medium transition-all flex items-center gap-1.5",
                                activeTab === tab.id
                                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                            )}
                        >
                            {tab.label}
                            {tab.count !== null && (
                                <span className={cn(
                                    "px-1 rounded-full text-[9px] min-w-[14px] flex items-center justify-center h-3.5",
                                    activeTab === tab.id
                                        ? "bg-primary/10 text-primary"
                                        : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                                )}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden p-2 min-h-0 relative">
                    <AnimatePresence mode="wait" initial={!reduceMotion}>
                        {activeTab === "focus" && (
                            <motion.div
                                key="focus"
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                                transition={reduceMotion ? { duration: 0 } : undefined}
                                className="h-full overflow-y-auto space-y-1.5 p-1"
                            >
                            {myFocusTasks.length > 0 ? myFocusTasks.map(task => (
                                <button
                                    key={task.id}
                                    onClick={() => onTaskClick(task.id)}
                                    className="w-full text-left p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-100 dark:border-zinc-800 hover:bg-white dark:hover:bg-zinc-800 hover:border-primary/20 transition-colors group"
                                >
                                    <div className="flex items-start gap-2">
                                        <div className="mt-0.5">
                                            <Zap className="w-3.5 h-3.5 text-amber-500 fill-current" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1 group-hover:text-primary transition-colors">
                                                {task.title}
                                            </p>
                                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                {task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString()}` : "No due date"}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            )) : (
                                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                                    <div className="w-10 h-10 rounded-full bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center mb-2">
                                        <Zap className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
                                    </div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">All caught up! No active tasks assigned to you.</p>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {activeTab === "stream" && (
                            <motion.div
                                key="stream"
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                                transition={reduceMotion ? { duration: 0 } : undefined}
                                className="h-full overflow-y-auto space-y-3 p-1"
                            >
                            {activities.length > 0 ? activities.map(activity => (
                                <div key={activity.id} className="flex gap-2.5">
                                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0" />
                                    <div>
                                        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                                {activity.actor?.name || "User"}
                                            </span>
                                            {" "}{activity.description || "updated the project"}
                                        </p>
                                        <p className="text-[10px] text-zinc-400 mt-0.5">
                                            {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                                        </p>
                                    </div>
                                </div>
                            )) : (
                                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">No recent activity.</p>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {activeTab === "team" && (
                            <motion.div
                                key="team"
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                                transition={reduceMotion ? { duration: 0 } : undefined}
                                className="h-full overflow-y-auto space-y-1.5 p-1"
                            >
                            {teamTasks.length > 0 ? teamTasks.map(task => (
                                <button
                                    key={task.id}
                                    onClick={() => onTaskClick(task.id)}
                                    className="w-full text-left p-2 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                                >
                                    <div className="flex items-start gap-2">
                                        <div className="mt-0.5">
                                            <Users className="w-3.5 h-3.5 text-zinc-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                                {task.title}
                                            </p>
                                            <p className="text-[10px] text-zinc-400 mt-0.5">Unassigned</p>
                                        </div>
                                    </div>
                                </button>
                            )) : (
                                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">No unassigned tasks.</p>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
                <button
                    onClick={onViewBoard}
                    className="w-full py-1.5 flex items-center justify-center gap-1.5 rounded-lg text-[10px] font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-primary transition-colors"
                >
                    <Layout className="w-3.5 h-3.5" />
                    Go to Task Board
                </button>
            </div>
        </div>
    );
}
