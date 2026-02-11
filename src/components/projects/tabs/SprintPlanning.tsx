import React, { useState, useMemo } from "react";
import { Plus, ChevronRight, CalendarDays, CheckCircle, Paperclip, Flag, MoreHorizontal, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import CreateSprintModal from "@/components/projects/v2/sprints/CreateSprintModal";
import { createSprintAction } from "@/app/actions/project";
import { useProjectSprints, useSprintTasks } from "@/hooks/hub/useProjectData";

export interface Sprint {
    id: string;
    projectId: string;
    name: string;
    goal?: string | null;
    startDate: string;
    endDate: string;
    status: "planning" | "active" | "completed";
    createdAt: string;
}

export interface SprintTask {
    id: string;
    sprintId: string | null;
    title: string;
    status: "todo" | "in_progress" | "done" | "blocked";
    priority: "low" | "medium" | "high" | "urgent";
    storyPoints?: number | null;
    updatedAt?: string | null;
    assignee?: { id: string; fullName: string | null; avatarUrl: string | null } | null;
    creator?: { id: string; fullName: string | null; avatarUrl: string | null } | null;
    attachments?: any[];
}

interface SprintPlanningProps {
    projectId: string;
    isOwnerOrMember: boolean;
    sprints: Sprint[];
    tasks: SprintTask[]; // Still passed but might be ignored or used as fallback
    onCreateSprint: () => void;
    onStartSprint: (sprintId: string) => void;
    onCompleteSprint: (sprintId: string) => void;
    onMoveTask: (taskId: string, sprintId: string | null) => void;
}

export default function SprintPlanning({
    projectId,
    isOwnerOrMember,
    sprints,
    onCreateSprint,
    onStartSprint,
    onCompleteSprint,
}: SprintPlanningProps) {
    const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Data Fetching
    const { data: fetchedSprints, isLoading: loadingSprints } = useProjectSprints(projectId, sprints);

    const activeSprints = fetchedSprints || [];

    // Sort sprints: Active first, then by creation date
    const sortedSprints = useMemo(() => {
        return [...activeSprints].sort((a, b) => {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (a.status !== 'active' && b.status === 'active') return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [activeSprints]);

    // Auto-select first sprint
    const activeSprint = activeSprints.find(s => s.status === 'active');
    const displaySprintId = selectedSprintId || activeSprint?.id || sortedSprints[0]?.id;
    const currentSprint = activeSprints.find(s => s.id === displaySprintId);

    // Filtered tasks for selected sprint (Fetched from server now!)
    const {
        data: sprintTasksData,
        isLoading: loadingTasks,
        fetchNextPage: fetchNextSprintTasks,
        hasNextPage: hasNextSprintTasks,
        isFetchingNextPage: isFetchingNextSprintTasks,
    } = useSprintTasks(displaySprintId || "");

    const safeSprintTasks = useMemo(() => {
        return (sprintTasksData?.pages.flatMap((p: any) => p.tasks) || []) as SprintTask[];
    }, [sprintTasksData]);

    const goalText = currentSprint?.goal || "Focus on delivering value.";

    // Calculate Progress
    const progress = useMemo(() => {
        if (safeSprintTasks.length === 0) return 0;
        const done = safeSprintTasks.filter(t => t.status === 'done').length;
        return Math.round((done / safeSprintTasks.length) * 100);
    }, [safeSprintTasks]);

    // Loading State
    if (loadingSprints && !activeSprints.length) {
        return (
            <div className="flex gap-6 h-[calc(100vh-200px)] overflow-hidden">
                <div className="w-[320px] flex-shrink-0 flex flex-col gap-4">
                     <div className="h-4 w-24 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                     <div className="h-10 w-full bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                     <div className="space-y-3">
                         {[1, 2, 3].map(i => (
                             <div key={i} className="h-24 w-full bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
                         ))}
                     </div>
                </div>
                <div className="flex-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
                    <div className="h-8 w-1/3 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse mb-6" />
                    <div className="h-32 w-full bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse mb-6" />
                    <div className="space-y-4">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-16 w-full bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Empty state
    if (activeSprints.length === 0 && !loadingSprints) {
        return (
            <div className="flex flex-col items-center justify-center h-[500px] bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                <div className="text-center space-y-4 max-w-md px-6">
                    <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center mx-auto">
                        <CalendarDays className="w-8 h-8 text-zinc-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Sprints Yet</h3>
                        <p className="text-sm text-zinc-500">Create your first sprint to start tracking goals and progress.</p>
                    </div>
                    {isOwnerOrMember && (
                        <>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Create Sprint
                            </button>
                            <CreateSprintModal
                                isOpen={showCreateModal}
                                onClose={() => setShowCreateModal(false)}
                                onCreate={async (data) => {
                                    try {
                                        const result = await createSprintAction({ ...data, projectId });
                                        if (result.success) {
                                            if (onCreateSprint) onCreateSprint();
                                            setShowCreateModal(false);
                                            toast.success("Sprint created");
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        toast.error("Failed to create sprint");
                                    }
                                }}
                                sprintCount={0}
                            />
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex gap-6 h-[calc(100vh-200px)] overflow-hidden">
            {/* LEFT SIDEBAR: Sprint Cards - Fixed width */}
            <div className="w-[320px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Sprint History</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Select a goal to view details</p>
                </div>

                {isOwnerOrMember && (
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="w-full py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm shrink-0"
                    >
                        <Plus className="w-4 h-4" />
                        New Goal
                    </button>
                )}

                <div className="space-y-2.5 pb-10">
                    {sortedSprints.map(sprint => (
                        <button
                            key={sprint.id}
                            onClick={() => setSelectedSprintId(sprint.id)}
                            className={cn(
                                "w-full text-left p-4 rounded-xl transition-all relative group border flex flex-col gap-3",
                                currentSprint?.id === sprint.id
                                    ? "bg-white dark:bg-zinc-900 border-indigo-500/50 shadow-md ring-1 ring-indigo-500/20"
                                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm"
                            )}
                        >
                            {/* Status Stripe */}
                            {sprint.status === 'active' && (
                                <div className="absolute left-0 top-3 bottom-3 w-1 bg-emerald-500 rounded-r-full" />
                            )}

                            {/* Header: Name + Status */}
                            <div className="flex items-center justify-between w-full">
                                <span className={cn(
                                    "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide",
                                    sprint.status === 'active' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" :
                                    sprint.status === 'completed' ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" :
                                    "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                                )}>
                                    {sprint.status}
                                </span>
                                {currentSprint?.id === sprint.id && (
                                    <motion.div layoutId="active-indicator">
                                        <ChevronRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                    </motion.div>
                                )}
                            </div>
                            
                            {/* Sprint Name */}
                            <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 leading-tight">
                                {sprint.name}
                            </h4>

                            {/* Goal Display - Enhancement */}
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-lg border border-zinc-100 dark:border-zinc-800/50 line-clamp-2">
                                <span className="font-semibold text-zinc-700 dark:text-zinc-300 mr-1">Goal:</span>
                                {sprint.goal || "No goal set for this sprint."}
                            </div>
                            
                            {/* Dates */}
                            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 font-medium pt-1">
                                <CalendarDays className="w-3 h-3 shrink-0" />
                                <span>
                                    {sprint.startDate && sprint.endDate ? (
                                        `${format(new Date(sprint.startDate), "MMM d")} - ${format(new Date(sprint.endDate), "MMM d")}`
                                    ) : "No dates"}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* RIGHT CONTENT: Sprint Details - Flexible width */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                {currentSprint ? (
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentSprint.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="flex flex-col h-full"
                        >
                            {/* Sprint Header */}
                            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 shrink-0 bg-zinc-50/50 dark:bg-zinc-900/50">
                                <div className="flex items-start justify-between gap-6 mb-6">
                                    <div>
                                         <div className="flex items-center gap-3 mb-2">
                                            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                                {currentSprint.name}
                                            </h2>
                                            <span className={cn(
                                                "text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide border",
                                                currentSprint.status === 'active' 
                                                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400" 
                                                    : "bg-zinc-100 border-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400"
                                            )}>
                                                {currentSprint.status}
                                            </span>
                                         </div>
                                        <p className="text-lg text-zinc-600 dark:text-zinc-400 font-serif italic">
                                            {`"${goalText}"`}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                         <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
                                            {progress}%
                                         </div>
                                         <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Complete</div>
                                    </div>
                                </div>

                                {/* Stats Bar */}
                                <div className="flex items-center gap-6 text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                                    <div className="flex items-center gap-2">
                                        <CalendarDays className="w-4 h-4" />
                                        <span>
                                            {format(new Date(currentSprint.startDate), "MMM d")} - {format(new Date(currentSprint.endDate), "MMM d, yyyy")}
                                        </span>
                                    </div>
                                    <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
                                    <div>
                                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 mr-1">{safeSprintTasks.length}</span> Tasks
                                    </div>
                                    <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
                                    <div>
                                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 mr-1">
                                            {safeSprintTasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0)}
                                        </span> 
                                        Points
                                    </div>
                                </div>
                            </div>

                            {/* Tasks List - Architectural View */}
                            <div className="flex-1 overflow-y-auto p-0 bg-zinc-50/30 dark:bg-black/20">
                                {loadingTasks ? (
                                    <div className="p-6 space-y-4">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="h-16 w-full bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                                        ))}
                                    </div>
                                ) : safeSprintTasks.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-center p-10">
                                        <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                                            <CheckCircle className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                                        </div>
                                        <p className="text-zinc-900 dark:text-zinc-100 font-medium">No tasks in this sprint</p>
                                        <p className="text-zinc-500 text-sm mt-1">Assign tasks from the Tasks tab to see them here.</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                                        {safeSprintTasks.map(task => (
                                            <div
                                                key={task.id}
                                                className="group flex items-center gap-4 p-4 hover:bg-white dark:hover:bg-zinc-900 transition-all border-l-2 border-transparent hover:border-indigo-500"
                                            >
                                                {/* 1. Status & Identity */}
                                                <div className="w-[40px] shrink-0 flex justify-center">
                                                    <div className={cn(
                                                        "w-2.5 h-2.5 rounded-full ring-2 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-900",
                                                        task.status === 'done' ? "bg-emerald-500 ring-emerald-200 dark:ring-emerald-900" :
                                                        task.status === 'in_progress' ? "bg-blue-500 ring-blue-200 dark:ring-blue-900" :
                                                        task.status === 'blocked' ? "bg-red-500 ring-red-200 dark:ring-red-900" :
                                                        "bg-zinc-300 ring-zinc-200 dark:ring-zinc-700"
                                                    )} />
                                                </div>

                                                {/* 2. Title & ID */}
                                                <div className="flex-1 min-w-0 grid gap-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <h4 className={cn(
                                                            "font-medium text-[15px] truncate transition-colors",
                                                            task.status === 'done' ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                                                        )}>
                                                            {task.title}
                                                        </h4>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                                                        <span className="font-mono">TASK</span>
                                                        <span>•</span>
                                                        <span className="capitalize">{task.status.replace('_', ' ')}</span>
                                                    </div>
                                                </div>

                                                {/* 3. People (Assignee + Reporter) */}
                                                <div className="hidden sm:flex items-center gap-3 shrink-0 px-2 min-w-[140px]">
                                                    {/* Creator/Reporter */}
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Rep</span>
                                                        {task.creator ? (
                                                            <div className="flex items-center gap-1.5" title={`Reporter: ${task.creator.fullName}`}>
                                                                <span className="text-xs text-zinc-600 dark:text-zinc-400 max-w-[80px] truncate">
                                                                    {task.creator.fullName?.split(' ')[0]}
                                                                </span>
                                                                <div className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border border-zinc-200 dark:border-zinc-700">
                                                                    {task.creator.avatarUrl ? (
                                                                        <img src={task.creator.avatarUrl} alt="" className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <User className="w-3 h-3 text-zinc-400" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : <span className="text-xs text-zinc-300">-</span>}
                                                    </div>

                                                    <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800" />

                                                    {/* Assignee */}
                                                    <div className="flex flex-col items-start">
                                                        <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Asg</span>
                                                        {task.assignee ? (
                                                             <div className="flex items-center gap-1.5" title={`Assignee: ${task.assignee.fullName}`}>
                                                                <div className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center overflow-hidden border border-indigo-100 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs font-semibold">
                                                                    {task.assignee.avatarUrl ? (
                                                                        <img src={task.assignee.avatarUrl} alt="" className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        task.assignee.fullName?.[0] || <User className="w-3 h-3" />
                                                                    )}
                                                                </div>
                                                                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 max-w-[80px] truncate">
                                                                    {task.assignee.fullName?.split(' ')[0]}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs italic text-zinc-400">Unassigned</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* 4. Context Metadata (Files, Pts, Priority) */}
                                                <div className="hidden md:flex items-center gap-4 shrink-0 px-2 min-w-[120px] justify-end">
                                                    {/* Attachments */}
                                                    {task.attachments && task.attachments.length > 0 && (
                                                        <div className="flex items-center gap-1 text-zinc-400" title={`${task.attachments.length} attachments`}>
                                                            <Paperclip className="w-3.5 h-3.5" />
                                                            <span className="text-xs font-medium">{task.attachments.length}</span>
                                                        </div>
                                                    )}

                                                    {/* Priority */}
                                                    <div title={`Priority: ${task.priority}`}>
                                                        <Flag className={cn(
                                                            "w-4 h-4",
                                                            task.priority === 'urgent' ? 'text-red-500 fill-red-500' :
                                                            task.priority === 'high' ? 'text-orange-500 fill-orange-500' :
                                                            task.priority === 'medium' ? 'text-yellow-500' : 'text-zinc-300'
                                                        )} />
                                                    </div>

                                                    {/* Story Points */}
                                                    {task.storyPoints !== null && (
                                                        <span className="text-xs font-mono font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                                                            {task.storyPoints}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* 5. Actions */}
                                                <div className="shrink-0 pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {hasNextSprintTasks && (
                                            <div className="p-4">
                                                <button
                                                    onClick={() => fetchNextSprintTasks()}
                                                    disabled={isFetchingNextSprintTasks}
                                                    className="w-full py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-60"
                                                >
                                                    {isFetchingNextSprintTasks ? "Loading more tasks..." : "Load more tasks"}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </AnimatePresence>
                ) : null}
            </div>

            <CreateSprintModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={async (data) => {
                    try {
                        const result = await createSprintAction({ ...data, projectId });
                        if (result.success) {
                            if (onCreateSprint) onCreateSprint();
                            setShowCreateModal(false);
                            toast.success("Sprint created");
                        } else {
                            toast.error(result.error);
                        }
                    } catch {
                        toast.error("Failed to create sprint");
                    }
                }}
                sprintCount={sprints.length}
            />
        </div>
    );
}
