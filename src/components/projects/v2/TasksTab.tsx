"use client";

import { useState, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Plus, LayoutGrid, List, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import { useRealtimeTasks } from "@/hooks/useRealtimeTasks";
import { createTaskAction } from "@/app/actions/project";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

import TaskFilters from "@/components/projects/v2/tasks/TaskFilters";
import KanbanBoard from "@/components/projects/v2/tasks/KanbanBoard";
import TasksTable from "@/components/projects/v2/tasks/TasksTable";
import CreateTaskModal from "@/components/projects/v2/tasks/CreateTaskModal";
import TaskDetailPanel from "@/components/projects/v2/tasks/TaskDetailPanel";
import { Task } from "@/components/projects/v2/tasks/TaskCard";

import FocusStrip from "./tasks/components/FocusStrip";
import { useTaskFilters } from "./tasks/hooks/useTaskFilters";
import { useProjectInfiniteTasks, type ProjectTaskScope } from "@/hooks/hub/useProjectData";
import { queryKeys } from "@/lib/query-keys";
import { patchSprintDetailInfiniteData } from "@/lib/projects/sprint-cache";
import { normalizeSprintOptions, normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";
import type { ProjectNode } from "@/lib/db/schema";

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

function toLinkedSprintFiles(nodes: ProjectNode[], taskId: string, occurredAt: string | null) {
    return nodes.map((node, index) => ({
        id: `linked-file:${taskId}:${node.id}:${index}`,
        taskId,
        nodeId: node.id,
        nodeName: node.name,
        nodePath: node.path ?? node.name,
        nodeType: node.type === "folder" ? ("folder" as const) : ("file" as const),
        annotation: null,
        linkedAt: occurredAt,
        lastEventType: null,
        lastEventAt: node.updatedAt instanceof Date ? node.updatedAt.toISOString() : null,
        lastEventBy: null,
    }));
}

function isProjectNode(value: unknown): value is ProjectNode {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ProjectNode>;
    return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.type === "string";
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
    const reduceMotion = useReducedMotionPreference();
    const queryClient = useQueryClient();
    const sprintOptions = useMemo(() => normalizeSprintOptions(sprints), [sprints]);
    const sprintById = useMemo(() => new Map(sprintOptions.map((sprint) => [sprint.id, sprint])), [sprintOptions]);
    // Local State
    const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
    const [scope, setScope] = useState<'all' | 'backlog' | 'sprint'>('all');
    const [isBulkMode, setIsBulkMode] = useState(false);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [createTaskError, setCreateTaskError] = useState<string | null>(null);
    const queryScope: ProjectTaskScope = useMemo(() => {
        if (scope === "backlog") return "backlog";
        if (scope === "sprint") return "sprint";
        return "all";
    }, [scope]);

    // Hook Integration: Smart Fetching (Infinite Loading)
    const { 
        data: infiniteData, 
        isLoading, 
        fetchNextPage, 
        hasNextPage, 
        isFetchingNextPage 
    } = useProjectInfiniteTasks(projectId, initialTasks, queryScope);
    
    // Flatten pages for filtering and focus strips
    const fetchedTasks = useMemo(() => {
        return (infiniteData?.pages.flatMap(page => page.tasks) || []) as Task[];
    }, [infiniteData]);
    
    // Combine realtime updates with fetched data
    const { tasks: allTasks, setTasks } = useRealtimeTasks(projectId, fetchedTasks.length > 0 ? fetchedTasks : undefined); 
    const sprintAwareTasks = useMemo(() => {
        return allTasks.map((task) => {
            const normalizedTask = normalizeTaskSurfaceRecord(task);
            if (normalizedTask.sprint || !normalizedTask.sprintId) return task;
            const sprint = sprintById.get(normalizedTask.sprintId);
            if (!sprint) return task;
            return {
                ...task,
                sprint: {
                    id: sprint.id,
                    name: sprint.name,
                    status: sprint.status,
                },
                sprintName: sprint.name,
            };
        });
    }, [allTasks, sprintById]);
    const withSprintContext = useCallback((task: Task) => {
        const normalizedTask = normalizeTaskSurfaceRecord(task);
        if (normalizedTask.sprint || !normalizedTask.sprintId) return task;
        const sprint = sprintById.get(normalizedTask.sprintId);
        if (!sprint) return task;
        return {
            ...task,
            sprint: {
                id: sprint.id,
                name: sprint.name,
                status: sprint.status,
            },
            sprintName: sprint.name,
        } as Task;
    }, [sprintById]);

    // Optimized Filters Hook
    const { filteredTasks, myFocusTasks, needsOwnerTasks } = useTaskFilters({
        tasks: sprintAwareTasks,
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

    const handleCreateTask = useCallback(async (data: any): Promise<{ success: boolean; error?: string }> => {
        setCreateTaskError(null);
        try {
            const result = await createTaskAction({
                projectId,
                title: data.title,
                description: data.description || "",
                priority: data.priority || "medium",
                status: data.status || "todo",
                assigneeId: data.assigneeId || null,
                sprintId: data.sprintId || null,
                storyPoints: data.storyPoints || undefined,
                dueDate: data.dueDate || null,
                subtasks: data.subtasks || [],
                attachmentNodeIds: data.attachmentIds || [],
            });

            if (!result.success || !result.task) {
                const error = result.error || "Failed to create task";
                setCreateTaskError(error);
                return { success: false, error };
            }

            const createdTask = result.task as unknown as Task;
            const normalizedCreatedTask = normalizeTaskSurfaceRecord(createdTask);
            const sprintAwareTask = withSprintContext(createdTask);
            setTasks((prev) => {
                if (prev.some((task) => task.id === sprintAwareTask.id)) {
                    return prev.map((task) => (task.id === sprintAwareTask.id ? sprintAwareTask : task));
                }
                return [sprintAwareTask, ...prev];
            });
            if (normalizedCreatedTask.sprintId) {
                const linkedFiles = Array.isArray(data.attachments)
                    ? toLinkedSprintFiles(
                        data.attachments.filter(isProjectNode),
                        normalizedCreatedTask.id,
                        normalizedCreatedTask.updatedAt ?? normalizedCreatedTask.createdAt,
                    )
                    : [];
                queryClient.setQueriesData(
                    { queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) },
                    (existing: unknown) =>
                        patchSprintDetailInfiniteData(existing, null, {
                            id: normalizedCreatedTask.id,
                            projectId,
                            projectKey: normalizedCreatedTask.projectKey,
                            title: normalizedCreatedTask.title,
                            description: normalizedCreatedTask.description,
                            status: normalizedCreatedTask.status,
                            priority: normalizedCreatedTask.priority,
                            storyPoints: normalizedCreatedTask.storyPoints,
                            sprintId: normalizedCreatedTask.sprintId,
                            createdAt: normalizedCreatedTask.createdAt,
                            updatedAt: normalizedCreatedTask.updatedAt,
                            taskNumber: normalizedCreatedTask.taskNumber,
                            assignee: normalizedCreatedTask.assignee,
                            creator: normalizedCreatedTask.creator,
                            linkedFileCount: linkedFiles.length,
                            linkedFiles,
                        }),
                );
            }
            void Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprints(projectId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) }),
            ]);
            return { success: true };
        } catch (err) {
            console.error("Exception creating task", err);
            const error = "An error occurred while creating the task";
            setCreateTaskError(error);
            return { success: false, error };
        }
    }, [projectId, queryClient, setTasks, withSprintContext]);

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
            {/* Sticky Header — matches Hub page header style */}
            <div className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Task Board</h2>
                        <p className="mt-0.5 text-sm text-zinc-500">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">{filteredTasks.length}</span>{" "}
                            {filteredTasks.length === 1 ? "task" : "tasks"} visible
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* View Mode Toggle — Hub-style pill group */}
                        <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
                            <button
                                onClick={() => setViewMode('board')}
                                className={cn(
                                    "p-2 rounded-md transition-colors",
                                    viewMode === 'board'
                                        ? "bg-white dark:bg-zinc-700 shadow-sm text-primary"
                                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                )}
                                title="Board view"
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    "p-2 rounded-md transition-colors",
                                    viewMode === 'list'
                                        ? "bg-white dark:bg-zinc-700 shadow-sm text-primary"
                                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                )}
                                title="List view"
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Filter — kept from TaskFilters */}
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

                        {/* New Task — Hub-style indigo rounded-xl */}
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex items-center gap-2 px-4 py-2 app-accent-solid hover:bg-primary/90 rounded-xl font-medium transition-[background-color,box-shadow]"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline">New Task</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Focus Strips */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                 <FocusStrip 
                    title="My Focus" 
                    icon={Users} 
                    iconColorClass="text-primary"
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
                        <button className="px-2 py-1 text-xs bg-primary/10 text-primary rounded border border-primary/15 hover:bg-primary/15">Claim</button>
                    )}
                 />
            </div>

            {createTaskError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {createTaskError}
                </div>
            ) : null}

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
                sprints={sprintOptions}
            />

            <AnimatePresence initial={!reduceMotion}>
                {editingTask && (
                    <TaskDetailPanel
                        task={editingTask}
                        onTaskUpdated={(nextTask) => {
                            const sprintAwareTask = withSprintContext(nextTask as Task);
                            setEditingTask(sprintAwareTask);
                            setTasks((prev) => prev.map((task) => (task.id === sprintAwareTask.id ? {
                                ...task,
                                ...sprintAwareTask,
                            } : task)));
                        }}
                        onClose={() => setEditingTask(null)}
                        projectId={projectId}
                        isOwnerOrMember={isOwnerOrMember}
                        isOwner={isOwner}
                        members={members}
                        sprints={sprintOptions}
                        currentUserId={currentUserId}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
