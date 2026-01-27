"use client";

import { useState, useMemo } from "react";
import { Users, UserPlus, ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useRealtimeTasks } from "@/hooks/useRealtimeTasks";
import { createTaskAction } from "@/app/actions/project";

import TaskFilters from "@/components/projects/v2/tasks/TaskFilters";
import KanbanBoard from "@/components/projects/v2/tasks/KanbanBoard";
import TasksTable from "@/components/projects/v2/tasks/TasksTable";
import CreateTaskModal from "@/components/projects/v2/tasks/CreateTaskModal";
import TaskDetailPanel from "@/components/projects/v2/tasks/TaskDetailPanel";
import { Task } from "@/components/projects/v2/tasks/TaskCard";

interface TasksTabProps {
    projectId: string;
    projectName?: string;
    currentUserId?: string;
    isOwner?: boolean;
    isOwnerOrMember: boolean;
    projectCreatorId?: string;
    initialTasks?: any[]; // Allow loose typing from backend for now
    totalCount?: number;
}

export default function TasksTab({
    projectId,
    projectName,
    currentUserId,
    isOwner = false,
    isOwnerOrMember,
    projectCreatorId,
    initialTasks = [],
    totalCount = 0,
}: TasksTabProps) {
    // Local State
    const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
    const [scope, setScope] = useState<'all' | 'backlog' | 'sprint'>('all');
    const [isBulkMode, setIsBulkMode] = useState(false);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

    const [myFocusExpanded, setMyFocusExpanded] = useState(true);
    const [needsOwnerExpanded, setNeedsOwnerExpanded] = useState(true);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);

    // Realtime task updates (auto-refreshes when tasks change)
    const { tasks: allTasks } = useRealtimeTasks(projectId, initialTasks as Task[]);

    // Filtering Logic
    const filteredTasks = useMemo(() => {
        let tasks = [...allTasks];
        if (scope === 'backlog') {
            // Assume backlog means no sprint_id or specific status
            // For now, just a dummy filter if we don't have sprint data on tasks
            // tasks = tasks.filter(t => !t.sprint_id);
        }
        return tasks;
    }, [allTasks, scope]);

    const myFocusTasks = useMemo(() => {
        if (!currentUserId) return [];
        return filteredTasks.filter(t => 
            t.assignee_id === currentUserId && 
            t.status !== 'done'
        );
    }, [filteredTasks, currentUserId]);

    const needsOwnerTasks = useMemo(() => {
        return filteredTasks.filter(t => 
            !t.assignee_id && 
            t.status !== 'done'
        );
    }, [filteredTasks]);

    // Handlers
    const toggleTaskSelection = (taskId: string) => {
        const newSet = new Set(selectedTaskIds);
        if (newSet.has(taskId)) newSet.delete(taskId);
        else newSet.add(taskId);
        setSelectedTaskIds(newSet);
    };

    const handleCreateTask = async (data: any) => {
        try {
            const taskData = {
                projectId,
                title: data.title,
                description: data.description || "",
                priority: data.priority || "medium",
                status: "todo" as const,
                assigneeId: data.assigneeId || null,
                sprintId: data.sprintId || null,
                storyPoints: data.storyPoints || undefined,
                dueDate: data.dueDate || null,
            };

            const result = await createTaskAction(taskData);
            
            if (result.success) {
                setShowCreateModal(false);
                // Task will auto-update via realtime subscription
            } else {
                console.error("Failed to create task:", result.error);
                alert(result.error || "Failed to create task");
            }
        } catch (error) {
            console.error("Error creating task:", error);
            alert("An error occurred while creating the task");
        }
    };

    return (
        <div className="space-y-4 relative">
            {/* Sticky Header */}
            <div className="sticky top-0 z-40 bg-zinc-50/95 dark:bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800 pb-4 -mx-6 px-6 pt-0 -mt-2">
                <div className="h-4"></div> {/* Spacer for top padding consistency without breaking sticky */}
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Task Board</h2>
                        </div>
                        <div className="mt-1 text-sm text-zinc-500">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">{filteredTasks.length}</span> visible
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <TaskFilters
                            viewMode={viewMode}
                            setViewMode={setViewMode}
                            scope={scope}
                            setScope={setScope}
                            isBulkMode={isBulkMode}
                            setBulkMode={(enabled) => {
                                setIsBulkMode(enabled);
                                if (!enabled) setSelectedTaskIds(new Set());
                            }}
                            isReorderMode={isReorderMode}
                            setReorderMode={setIsReorderMode}
                            activeCount={0}
                            selectedCount={selectedTaskIds.size}
                        />
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium whitespace-nowrap shadow-sm"
                        >
                            New Task
                        </button>
                    </div>
                </div>
            </div>

            {/* Focus Strips */}
            {(myFocusTasks.length > 0 || needsOwnerTasks.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* My Focus */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                        <button
                            onClick={() => setMyFocusExpanded(!myFocusExpanded)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3"
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                <Users className="w-4 h-4 text-indigo-500" />
                                My Focus
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500">{myFocusTasks.length}</span>
                                {myFocusExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                            </div>
                        </button>
                        {myFocusExpanded && (
                            <div className="px-4 pb-4 space-y-2">
                                {myFocusTasks.map(task => (
                                    <div key={task.id} onClick={() => setEditingTask(task)} className="p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-700">
                                        <div className="font-medium text-sm text-zinc-800 dark:text-zinc-200">{task.title}</div>
                                        <div className="text-xs text-zinc-500 mt-1 capitalize">{task.status.replace('_', ' ')} • {task.priority}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Needs Owner */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                        <button
                            onClick={() => setNeedsOwnerExpanded(!needsOwnerExpanded)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3"
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                <UserPlus className="w-4 h-4 text-orange-500" />
                                Needs Owner
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500">{needsOwnerTasks.length}</span>
                                {needsOwnerExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                            </div>
                        </button>
                        {needsOwnerExpanded && (
                            <div className="px-4 pb-4 space-y-2">
                                {needsOwnerTasks.map(task => (
                                    <div key={task.id} onClick={() => setEditingTask(task)} className="flex items-center justify-between p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-700">
                                        <div>
                                            <div className="font-medium text-sm text-zinc-800 dark:text-zinc-200">{task.title}</div>
                                            <div className="text-xs text-zinc-500 mt-1 capitalize">{task.priority}</div>
                                        </div>
                                        <button className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded border border-blue-100 hover:bg-blue-100">Claim</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Main Content */}
            {viewMode === 'board' ? (
                <KanbanBoard
                    tasks={filteredTasks}
                    onTaskClick={setEditingTask}
                    selectedTaskIds={selectedTaskIds}
                    toggleTaskSelection={toggleTaskSelection}
                    isBulkMode={isBulkMode}
                />
            ) : (
                <TasksTable
                    tasks={filteredTasks}
                    onTaskClick={setEditingTask}
                    selectedTaskIds={selectedTaskIds}
                    toggleTaskSelection={toggleTaskSelection}
                    isBulkMode={isBulkMode}
                />
            )}

            {/* Modals & Drawers */}
            <CreateTaskModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={handleCreateTask}
                projectId={projectId}
                projectName={projectName}
            />

            <AnimatePresence>
                {editingTask && (
                    <TaskDetailPanel
                        task={editingTask}
                        onClose={() => setEditingTask(null)}
                        projectId={projectId}
                        isOwnerOrMember={isOwnerOrMember}
                        isOwner={isOwner}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
