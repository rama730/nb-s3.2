"use client";

import { useState, useMemo } from "react";
import { Users, UserPlus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useRealtimeTasks } from "@/hooks/useRealtimeTasks";
import { createTaskAction } from "@/app/actions/project";

import TaskFilters from "@/components/projects/v2/tasks/TaskFilters";
import KanbanBoard from "@/components/projects/v2/tasks/KanbanBoard";
import TasksTable from "@/components/projects/v2/tasks/TasksTable";
import CreateTaskModal from "@/components/projects/v2/tasks/CreateTaskModal";
import TaskDetailPanel from "@/components/projects/v2/tasks/TaskDetailPanel";
import { Task } from "@/components/projects/v2/tasks/TaskCard";

import FocusStrip from "./tasks/components/FocusStrip";
import { useTaskFilters } from "./tasks/hooks/useTaskFilters";
import { useProjectInfiniteTasks } from "@/hooks/hub/useProjectData"; // Changed import

interface TasksTabProps {
    projectId: string;
    projectName?: string;
    currentUserId?: string;
    isOwner?: boolean;
    isOwnerOrMember: boolean;
    projectCreatorId?: string;
    initialTasks?: any[]; 
    totalCount?: number;
    members?: any[];
    sprints?: any[];
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
    members = [],
    sprints = [],
}: TasksTabProps) {
    // Local State
    const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
    const [scope, setScope] = useState<'all' | 'backlog' | 'sprint'>('all');
    const [isBulkMode, setIsBulkMode] = useState(false);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);

    // Hook Integration: Smart Fetching (Infinite Loading)
    const { 
        data: infiniteData, 
        isLoading, 
        fetchNextPage, 
        hasNextPage, 
        isFetchingNextPage 
    } = useProjectInfiniteTasks(projectId, initialTasks);
    
    // Flatten pages for filtering and focus strips
    const fetchedTasks = useMemo(() => {
        return (infiniteData?.pages.flatMap(page => page.tasks) || []) as Task[];
    }, [infiniteData]);
    
    // Combine realtime updates with fetched data
    const { tasks: allTasks, setTasks } = useRealtimeTasks(projectId, fetchedTasks.length > 0 ? fetchedTasks : undefined); 

    // Optimized Filters Hook
    const { filteredTasks, myFocusTasks, needsOwnerTasks } = useTaskFilters({
        tasks: allTasks,
        currentUserId,
        scope
    });

    // Handlers
    const toggleTaskSelection = (taskId: string) => {
        const newSet = new Set(selectedTaskIds);
        if (newSet.has(taskId)) newSet.delete(taskId);
        else newSet.add(taskId);
        setSelectedTaskIds(newSet);
    };

    const handleCreateTask = async (data: any) => {
        // Optimistic UI: Create fake task and show immediately
        const tempId = crypto.randomUUID();
        const optimisticTask: Task = {
            id: tempId,
            projectId,
            title: data.title,
            description: data.description || null,
            status: "todo",
            priority: data.priority || "medium",
            type: data.type || "task",
            taskNumber: 0, // Pending
            creatorId: currentUserId || null,
            assigneeId: data.assigneeId || null,
            sprintId: data.sprintId || null,
            storyPoints: data.storyPoints || null,
            dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Ensure other required Task fields are present with defaults
            subtasks: [],
            attachmentCount: data.attachmentIds?.length || 0,
            commentCount: 0,
            // Any other fields from Task interface
            tags: data.tags || [],
        } as unknown as Task; // Cast if partial

        setTasks(prev => [optimisticTask, ...prev]);
        setShowCreateModal(false); // Close immediately (0ms latency loop)

        // Run server action in background
        createTaskAction({
             projectId,
             title: data.title,
             description: data.description || "",
             priority: data.priority || "medium",
             status: "todo",
             assigneeId: data.assigneeId || null,
             sprintId: data.sprintId || null,
             storyPoints: data.storyPoints || undefined,
             dueDate: data.dueDate || null,
             attachmentNodeIds: data.attachmentIds || [],
        }).then(result => {
             if (result.success && result.task) {
                 // Replace optimistic with real
                 setTasks(prev => prev.map(t => t.id === tempId ? (result.task as unknown as Task) : t));
             } else {
                 // Revert on error
                 console.error("Failed to create task:", result.error);
                 setTasks(prev => prev.filter(t => t.id !== tempId));
                 alert(result.error || "Failed to create task");
             }
         }).catch(err => {
             console.error("Exception creating task", err);
             setTasks(prev => prev.filter(t => t.id !== tempId));
             alert("An error occurred while creating the task");
         });
    };

    // Loading State
    if (isLoading && !initialTasks?.length) {
        return (
            <div className="space-y-4">
                 <div className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded w-full animate-pulse" />
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="h-64 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                     <div className="h-64 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                     <div className="h-64 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                 </div>
            </div>
        );
    }
    
    return (
        <div className="space-y-4 relative">
            {/* Sticky Header */}
            <div className="sticky top-0 z-40 bg-zinc-50/95 dark:bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800 pb-4 -mx-6 px-6 pt-0 -mt-2">
                <div className="h-4"></div> 
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                 <FocusStrip 
                    title="My Focus" 
                    icon={Users} 
                    iconColorClass="text-indigo-500"
                    tasks={myFocusTasks}
                    onTaskClick={setEditingTask}
                 />
                 <FocusStrip 
                    title="Needs Owner" 
                    icon={UserPlus} 
                    iconColorClass="text-orange-500"
                    tasks={needsOwnerTasks}
                    onTaskClick={setEditingTask}
                    renderTaskAction={() => (
                        <button className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded border border-blue-100 hover:bg-blue-100">Claim</button>
                    )}
                 />
            </div>

            {/* Main Content */}
            {viewMode === 'board' ? (
                <KanbanBoard
                    tasks={filteredTasks}
                    onTaskClick={setEditingTask}
                    selectedTaskIds={selectedTaskIds}
                    toggleTaskSelection={toggleTaskSelection}
                    isBulkMode={isBulkMode}
                    fetchNextPage={fetchNextPage}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                />
            ) : (
                <TasksTable
                    tasks={filteredTasks}
                    onTaskClick={setEditingTask}
                    selectedTaskIds={selectedTaskIds}
                    toggleTaskSelection={toggleTaskSelection}
                    isBulkMode={isBulkMode}
                    fetchNextPage={fetchNextPage}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                />
            )}

            {/* Modals & Drawers */}
            <CreateTaskModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={handleCreateTask}
                projectId={projectId}
                projectName={projectName}
                members={members}
                sprints={sprints}
            />

            <AnimatePresence>
                {editingTask && (
                    <TaskDetailPanel
                        task={editingTask}
                        onClose={() => setEditingTask(null)}
                        projectId={projectId}
                        isOwnerOrMember={isOwnerOrMember}
                        isOwner={isOwner}
                        members={members}
                        sprints={sprints}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
