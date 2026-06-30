"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import { useRealtimeTasks } from "@/hooks/useRealtimeTasks";
import { createTaskAction, getProjectTaskDetailAction } from "@/app/actions/project";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

import { useTaskFilters } from "./tasks/hooks/useTaskFilters";
import { useProjectInfiniteTasks, useProjectSprints, type ProjectTaskScope } from "@/hooks/hub/useProjectTasksData";
import { patchSprintDetailInfiniteData } from "@/lib/projects/sprint-cache";
import { normalizeSprintOptions, normalizeTaskSurfaceRecord, type TaskSurfaceRecord } from "@/lib/projects/task-presentation";
import { buildTaskSubmitPayload } from "@/lib/projects/task-draft";
import { patchProjectTaskCaches } from "@/lib/projects/task-cache";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import { queryKeys } from "@/lib/query-keys";
import type { TaskPanelTab } from "@/hooks/useTaskPanelResource";

const CreateTaskModal = dynamic(() => import("@/components/projects/v2/tasks/CreateTaskModal"), { ssr: false });
const TaskDetailPanel = dynamic(() => import("@/components/projects/v2/tasks/TaskDetailPanel"), { ssr: false });
const TaskFilters = dynamic(() => import("@/components/projects/v2/tasks/TaskFilters"), { ssr: false });
const KanbanBoard = dynamic(() => import("@/components/projects/v2/tasks/KanbanBoard"), { ssr: false });
const FocusStrip = dynamic(() => import("./tasks/components/FocusStrip"), { ssr: false });

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
    initialOpenTaskId?: string | null;
    initialPanelTab?: TaskPanelTab | null;
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
    initialOpenTaskId = null,
    initialPanelTab = null,
}: TasksTabProps) {
    const reduceMotion = useReducedMotionPreference();
    const queryClient = useQueryClient();
    const { showToast } = useToast();
    const activeAssignableMemberIds = useMemo(() => new Set(
        members
            .filter((member) => String(member?.membershipRole ?? member?.role ?? "").toLowerCase() !== "viewer")
            .map((member) => String(member?.id ?? member?.userId ?? member?.user_id ?? member?.user?.id ?? ""))
            .filter(Boolean),
    ), [members]);
    // Local State
    const [scope, setScope] = useState<'all' | 'backlog' | 'sprint'>('all');

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskSurfaceRecord | null>(null);
    const [editingInitialTab, setEditingInitialTab] = useState<TaskPanelTab | null>(null);
    const [createTaskError, setCreateTaskError] = useState<string | null>(null);
    const [initialTaskLoadError, setInitialTaskLoadError] = useState<string | null>(null);
    const handledInitialOpenTaskRef = useRef<string | null>(null);
    const loadingInitialOpenTaskRef = useRef<string | null>(null);

    useEffect(() => {
        if (!initialOpenTaskId) {
            handledInitialOpenTaskRef.current = null;
            loadingInitialOpenTaskRef.current = null;
        }
    }, [initialOpenTaskId]);
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
        return (infiniteData?.pages.flatMap(page => page.tasks) || []).map(normalizeTaskSurfaceRecord);
    }, [infiniteData]);
    const hasSprintReferences = useMemo(
        () => fetchedTasks.some((task) => Boolean(normalizeTaskSurfaceRecord(task).sprintId)),
        [fetchedTasks],
    );
    const shouldFetchProjectSprints = scope !== "backlog" && (
        showCreateModal ||
        Boolean(editingTask) ||
        (hasSprintReferences && sprints.length === 0)
    );
    const { data: projectSprintsData, isFetched: hasFetchedProjectSprints } = useProjectSprints(
        projectId,
        sprints,
        shouldFetchProjectSprints,
    );
    const sprintOptions = useMemo(() => {
        const sprintSource = hasFetchedProjectSprints ? (projectSprintsData ?? []) : sprints;
        return normalizeSprintOptions(sprintSource);
    }, [hasFetchedProjectSprints, projectSprintsData, sprints]);
    const sprintById = useMemo(() => new Map(sprintOptions.map((sprint) => [sprint.id, sprint])), [sprintOptions]);

    useRealtimeTasks(projectId);

    const sprintAwareTasks = useMemo(() => {
        return fetchedTasks.map((task) => {
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
    }, [fetchedTasks, sprintById]);
    const withSprintContext = useCallback((task: TaskSurfaceRecord) => {
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
        } as TaskSurfaceRecord;
    }, [sprintById]);

    const openTask = useCallback((task: TaskSurfaceRecord | any, panelTab: TaskPanelTab | null = null) => {
        const normalized = withSprintContext(normalizeTaskSurfaceRecord(task));
        setEditingTask(normalized);
        setEditingInitialTab(panelTab);

        if (typeof window !== "undefined") {
            const taskCode = normalized.projectKey && normalized.taskNumber
                ? `${normalized.projectKey}-${normalized.taskNumber}`
                : normalized.id;
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.set('tab', 'tasks');
            nextParams.set('drawerType', 'task');
            nextParams.set('drawerId', taskCode);
            if (panelTab) {
                nextParams.set('panelTab', panelTab);
            } else {
                nextParams.delete('panelTab');
            }
            const nextQuery = nextParams.toString();
            const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
            window.history.replaceState(null, "", nextUrl);
        }
    }, [withSprintContext]);

    const closeTaskPanel = useCallback(() => {
        setEditingTask(null);
        setEditingInitialTab(null);

        if (typeof window !== "undefined") {
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.delete('drawerType');
            nextParams.delete('drawerId');
            nextParams.delete('panelTab');
            const nextQuery = nextParams.toString();
            const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
            window.history.replaceState(null, "", nextUrl);
        }
    }, []);

    // Optimized Filters Hook
    const { filteredTasks, myFocusTasks, needsOwnerTasks } = useTaskFilters({
        tasks: sprintAwareTasks,
        currentUserId,
        scope
    });
    const showMyFocusStrip = myFocusTasks.length > 0;
    const showNeedsOwnerStrip = needsOwnerTasks.length > 0;
    const hasFocusStrips = showMyFocusStrip || showNeedsOwnerStrip;
    const focusStripColumnsClass = showMyFocusStrip && showNeedsOwnerStrip ? "lg:grid-cols-2" : "lg:grid-cols-1";

    useEffect(() => {
        if (!initialOpenTaskId || handledInitialOpenTaskRef.current === initialOpenTaskId) return;
        if (loadingInitialOpenTaskRef.current === initialOpenTaskId) return;

        const matchesInitialTask = (task: any) => {
            if (!task || !initialOpenTaskId) return false;
            if (task.id === initialOpenTaskId) return true;
            if (initialOpenTaskId.includes("-")) {
                const dashIndex = initialOpenTaskId.lastIndexOf("-");
                const taskNum = parseInt(initialOpenTaskId.slice(dashIndex + 1), 10);
                if (!isNaN(taskNum) && task.taskNumber === taskNum) return true;
            }
            return false;
        };

        if (matchesInitialTask(editingTask)) return;

        const localTask = sprintAwareTasks.find(matchesInitialTask);
        if (localTask) {
            setInitialTaskLoadError(null);
            handledInitialOpenTaskRef.current = initialOpenTaskId;
            openTask(localTask, initialPanelTab);
            return;
        }

        let cancelled = false;
        loadingInitialOpenTaskRef.current = initialOpenTaskId;
        const reportInitialTaskLoadFailure = (reason: unknown) => {
            const detail = reason instanceof Error
                ? reason.message
                : typeof reason === "string"
                    ? reason
                    : "Task detail request failed";
            console.warn("Failed to load initial task", {
                projectId,
                taskId: initialOpenTaskId,
                error: detail,
            });
            const message = "Could not open the requested task. It may have been moved, deleted, or unavailable.";
            setInitialTaskLoadError(message);
            showToast(message, "error");
        };

        void getProjectTaskDetailAction(projectId, initialOpenTaskId).then((result) => {
            if (cancelled) return;
            if (!result.success || !result.task) {
                reportInitialTaskLoadFailure(result.error || "Task was not returned");
                return;
            }
            const normalizedTask = withSprintContext(normalizeTaskSurfaceRecord(result.task));
            patchProjectTaskCaches(queryClient, projectId, normalizedTask);
            setInitialTaskLoadError(null);
            handledInitialOpenTaskRef.current = initialOpenTaskId;
            openTask(normalizedTask, initialPanelTab);
        }).catch((error) => {
            if (cancelled) return;
            reportInitialTaskLoadFailure(error);
        }).finally(() => {
            if (loadingInitialOpenTaskRef.current === initialOpenTaskId) {
                loadingInitialOpenTaskRef.current = null;
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        initialOpenTaskId,
        initialPanelTab,
        editingTask,
        openTask,
        projectId,
        queryClient,
        showToast,
        sprintAwareTasks,
        withSprintContext,
    ]);

    const handleCreateTask = useCallback(async (data: any): Promise<{ success: boolean; error?: string }> => {
        setCreateTaskError(null);
        try {
            const result = await createTaskAction(data);

            if (!result.success || !result.task) {
                const error = result.error || "Failed to create task";
                setCreateTaskError(error);
                return { success: false, error };
            }

            const normalizedCreatedTask = withSprintContext(normalizeTaskSurfaceRecord(result.task));
            patchProjectTaskCaches(queryClient, projectId, normalizedCreatedTask);
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
            return { success: true };
        } catch (err) {
            console.error("Exception creating task", err);
            const error = "An error occurred while creating the task";
            setCreateTaskError(error);
            return { success: false, error };
        }
    }, [projectId, queryClient, withSprintContext]);

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
            <div className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm px-5 py-4 transform-gpu">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Task Board</h2>
                        <p className="mt-0.5 text-sm text-zinc-500">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">{filteredTasks.length}</span>{" "}
                            {filteredTasks.length === 1 ? "task" : "tasks"} visible
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Filter — kept from TaskFilters */}
                        <TaskFilters
                            scope={scope}
                            setScope={setScope}
                        />

                        {/* New Task — Hub-style indigo rounded-xl */}
                        {isOwnerOrMember ? (
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-2 px-4 py-2 app-accent-solid hover:bg-primary/90 rounded-xl font-medium transition-[background-color,box-shadow]"
                            >
                                <Plus className="w-4 h-4" />
                                <span className="hidden sm:inline">New Task</span>
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Focus Strips */}
            {hasFocusStrips ? (
                <div className={cn("grid grid-cols-1 items-start gap-3", focusStripColumnsClass)}>
                    {showMyFocusStrip ? (
                        <FocusStrip
                            title="My Focus"
                            icon={Users}
                            iconColorClass="text-primary"
                            tasks={myFocusTasks}
                            onTaskClick={openTask}
                        />
                    ) : null}
                    {showNeedsOwnerStrip ? (
                        <FocusStrip
                            title="Needs Owner"
                            icon={UserPlus}
                            iconColorClass="text-orange-500"
                            tasks={needsOwnerTasks}
                            onTaskClick={openTask}
                        />
                    ) : null}
                </div>
            ) : null}

            {createTaskError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {createTaskError}
                </div>
            ) : null}

            {initialTaskLoadError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {initialTaskLoadError}
                </div>
            ) : null}

            {/* Main Content */}
            <KanbanBoard
                tasks={filteredTasks}
                onTaskClick={openTask}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                activeAssignableMemberIds={activeAssignableMemberIds}
            />

            {/* Modals & Drawers */}
            {showCreateModal ? (
                <CreateTaskModal
                    isOpen={showCreateModal}
                    onClose={() => setShowCreateModal(false)}
                    onCreate={async (value) => {
                        const payload = buildTaskSubmitPayload({
                            draft: value.draft,
                            projectId,
                            subtasks: value.subtasks,
                            attachments: value.attachments,
                        });
                        return handleCreateTask({ ...payload, attachments: value.attachments });
                    }}
                    projectId={projectId}
                    projectName={projectName}
                    members={members}
                    sprints={sprintOptions}
                />
            ) : null}

            <AnimatePresence initial={!reduceMotion}>
                {editingTask && (
                    <TaskDetailPanel
                        task={editingTask}
                        onTaskUpdated={(nextTask) => {
                            const sprintAwareTask = withSprintContext(normalizeTaskSurfaceRecord(nextTask));
                            setEditingTask(sprintAwareTask);
                            patchProjectTaskCaches(queryClient, projectId, sprintAwareTask);
                        }}
                        onClose={closeTaskPanel}
                        initialTab={editingInitialTab}
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
