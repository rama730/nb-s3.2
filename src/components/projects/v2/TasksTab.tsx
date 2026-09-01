"use client";

import { toast } from "sonner";
import { filesReturnQuery } from "@/lib/files/task-navigation";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Plus, Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useRealtimeTasks } from "@/hooks/useRealtimeTasks";
import {
  createTaskAction,
  getProjectTaskDetailAction,
} from "@/app/actions/project";
import {
  createProjectWorkflowColumnAction,
  deleteProjectWorkflowColumnAction,
  getProjectWorkflowColumnsAction,
  updateProjectWorkflowColumnsAction,
} from "@/app/actions/project";
import { createClient } from "@/lib/supabase/client";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ProjectWorkflowColumn as WorkflowColumn } from "@/lib/db/schema";
import KanbanBoard from "@/components/projects/v2/tasks/KanbanBoard";
import TaskFilters from "@/components/projects/v2/tasks/TaskFilters";
import {
  useProjectInfiniteTasks,
  useProjectSprints,
  type ProjectTaskScope,
} from "@/hooks/hub/useProjectTasksData";
import {
  normalizeAssignableMembers,
  normalizeSprintOptions,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import { buildTaskSubmitPayload } from "@/lib/projects/task-draft";
import { patchProjectTaskCaches } from "@/lib/projects/task-cache";
import {
  getColumnColors,
  WORKFLOW_COLORS,
  type SemanticColor,
} from "@/lib/projects/workflow-colors";
import type { ProjectNode } from "@/lib/db/schema";
import { queryKeys } from "@/lib/query-keys";
import type { TaskPanelTab } from "@/hooks/useTaskPanelResource";

const CreateTaskModal = dynamic(
  () => import("@/components/projects/v2/tasks/CreateTaskModal"),
  { ssr: false },
);
const TaskDetailPanel = dynamic(
  () => import("@/components/projects/v2/tasks/TaskDetailPanel"),
  { ssr: false },
);

interface TasksTabProps {
  projectId: string;
  projectSlug?: string;
  projectName?: string;
  currentUserId?: string;
  isOwner?: boolean;
  canEditTasks: boolean;
  canManageFiles?: boolean;
  canManageWorkflow: boolean;
  initialTasks?: any[];
  members?: any[];
  sprints?: any[];
  initialOpenTaskId?: string | null;
  initialPanelTab?: TaskPanelTab | null;
  initialCommentId?: string | null;
  initialFileId?: string | null;
  onInitialTaskOpened?: () => void;
}

function isProjectNode(value: unknown): value is ProjectNode {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectNode>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.type === "string"
  );
}

export default function TasksTab({
  projectId,
  projectSlug,
  projectName,
  currentUserId,
  isOwner = false,
  canEditTasks,
  canManageFiles = false,
  canManageWorkflow,
  initialTasks = [],
  members = [],
  sprints = [],
  initialOpenTaskId = null,
  initialPanelTab = null,
  initialCommentId = null,
  initialFileId = null,
  onInitialTaskOpened,
}: TasksTabProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskSearchQuery = (searchParams.get("search") || "")
    .trim()
    .slice(0, 100);
  const activeAssignableMemberIds = useMemo(
    () =>
      new Set(normalizeAssignableMembers(members).map((member) => member.id)),
    [members],
  );
  // Local State
  const [scope, setScope] = useState<"all" | "backlog" | "sprint">(() => {
    const requestedScope = searchParams.get("taskScope");
    return requestedScope === "backlog" || requestedScope === "sprint"
      ? requestedScope
      : "all";
  });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionColor, setSectionColor] = useState<SemanticColor>("indigo");
  const [sectionStatus, setSectionStatus] = useState<
    "todo" | "in_progress" | "blocked" | "done"
  >("in_progress");
  const [addSectionError, setAddSectionError] = useState<string | null>(null);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [columnPendingDeletion, setColumnPendingDeletion] =
    useState<WorkflowColumn | null>(null);
  const [isDeletingColumn, setIsDeletingColumn] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskSurfaceRecord | null>(
    null,
  );
  const [editingInitialTab, setEditingInitialTab] =
    useState<TaskPanelTab | null>(null);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  const [initialTaskLoadError, setInitialTaskLoadError] = useState<
    string | null
  >(null);
  const handledInitialOpenTaskRef = useRef<string | null>(null);
  const loadingInitialOpenTaskRef = useRef<string | null>(null);
  const isTaskPanelClosingRef = useRef(false);
  const workflowRefreshQueuedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextParams = new URLSearchParams(window.location.search);
    if (scope === "all") nextParams.delete("taskScope");
    else nextParams.set("taskScope", scope);
    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [scope]);

  useEffect(() => {
    if (!initialOpenTaskId) {
      isTaskPanelClosingRef.current = false;
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
    isFetchingNextPage,
  } = useProjectInfiniteTasks(
    projectId,
    initialTasks,
    queryScope,
    taskSearchQuery,
  );

  // Flatten pages for filtering and focus strips
  const fetchedTasks = useMemo(() => {
    return (infiniteData?.pages.flatMap((page) => page.tasks) || []).map(
      normalizeTaskSurfaceRecord,
    );
  }, [infiniteData]);
  const hasSprintReferences = useMemo(
    () =>
      fetchedTasks.some((task) =>
        Boolean(normalizeTaskSurfaceRecord(task).sprintId),
      ),
    [fetchedTasks],
  );
  const shouldFetchProjectSprints =
    showCreateModal ||
      Boolean(editingTask) ||
      (scope !== "backlog" && hasSprintReferences && sprints.length === 0);
  const { data: projectSprintsData, isFetched: hasFetchedProjectSprints } =
    useProjectSprints(projectId, sprints, shouldFetchProjectSprints);
  const sprintOptions = useMemo(() => {
    const sprintSource = hasFetchedProjectSprints
      ? (projectSprintsData ?? [])
      : sprints;
    return normalizeSprintOptions(sprintSource);
  }, [hasFetchedProjectSprints, projectSprintsData, sprints]);
  const sprintById = useMemo(
    () => new Map(sprintOptions.map((sprint) => [sprint.id, sprint])),
    [sprintOptions],
  );

  const [realtimeDeferredTaskId, setRealtimeDeferredTaskId] = useState<
    string | null
  >(null);
  const workflowQueryKey = useMemo(
    () => queryKeys.project.detail.workflow(projectId),
    [projectId],
  );
  const workflowQuery = useQuery({
    queryKey: workflowQueryKey,
    queryFn: async () => {
      const result = await getProjectWorkflowColumnsAction(projectId);
      if (!result.success || !result.columns) {
        throw new Error(result.error || "Failed to load workflow");
      }
      return result.columns as WorkflowColumn[];
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  const workflow = workflowQuery.data ?? [];
  const workflowMutation = useMutation({
    scope: { id: `project-workflow-${projectId}` },
    mutationFn: async (nextWorkflow: WorkflowColumn[]) => {
      const positioned = nextWorkflow.map((column, position) => ({
        ...column,
        position,
      }));
      const result = await updateProjectWorkflowColumnsAction(
        projectId,
        positioned,
      );
      if (!result.success)
        throw new Error(result.error || "Failed to save workflow");
      return positioned;
    },
    onMutate: async (nextWorkflow) => {
      await queryClient.cancelQueries({ queryKey: workflowQueryKey });
      const previousWorkflow =
        queryClient.getQueryData<WorkflowColumn[]>(workflowQueryKey);
      queryClient.setQueryData(workflowQueryKey, nextWorkflow);
      return { previousWorkflow };
    },
    onError: (error, _nextWorkflow, context) => {
      if (context?.previousWorkflow)
        queryClient.setQueryData(workflowQueryKey, context.previousWorkflow);
      toast.error(
        error instanceof Error ? error.message : "Failed to save workflow",
      );
    },
  });
  const persistWorkflow = useCallback(
    (nextWorkflow: WorkflowColumn[]) => {
      workflowMutation.mutate(nextWorkflow);
    },
    [workflowMutation],
  );

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleWorkflowRefresh = () => {
      if (workflowMutation.isPending) {
        workflowRefreshQueuedRef.current = true;
        return;
      }
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void queryClient.invalidateQueries({ queryKey: workflowQueryKey });
      }, 50);
    };
    const channel = subscribeActiveResource({
      supabase,
      resourceType: "project_workflow",
      resourceId: projectId,
      bindings: [
        {
          event: "*",
          table: "project_workflow_columns",
          filter: `project_id=eq.${projectId}`,
          handler: scheduleWorkflowRefresh,
        },
      ],
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [projectId, queryClient, workflowMutation.isPending, workflowQueryKey]);

  useEffect(() => {
    if (workflowMutation.isPending || !workflowRefreshQueuedRef.current) return;
    workflowRefreshQueuedRef.current = false;
    void queryClient.invalidateQueries({ queryKey: workflowQueryKey });
  }, [queryClient, workflowMutation.isPending, workflowQueryKey]);

  useRealtimeTasks(projectId, realtimeDeferredTaskId);

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
  const withSprintContext = useCallback(
    (task: TaskSurfaceRecord) => {
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
    },
    [sprintById],
  );

  const openTask = useCallback(
    (
      task: TaskSurfaceRecord | any,
      panelTab: TaskPanelTab | null = null,
      preserveNestedTarget = false,
    ) => {
      isTaskPanelClosingRef.current = false;
      const normalized = withSprintContext(normalizeTaskSurfaceRecord(task));
      setEditingTask(normalized);
      setEditingInitialTab(panelTab);

      if (typeof window !== "undefined") {
        const nextParams = new URLSearchParams(window.location.search);
        let changed = false;
        for (const key of ["drawerType", "drawerId", "panelTab"]) {
          if (nextParams.has(key)) {
            nextParams.delete(key);
            changed = true;
          }
        }
        if (!preserveNestedTarget) {
          for (const key of ["commentId", "fileId"]) {
            if (nextParams.has(key)) {
              nextParams.delete(key);
              changed = true;
            }
          }
        }
        if (changed) {
          const nextQuery = nextParams.toString();
          const nextUrl = nextQuery
            ? `${window.location.pathname}?${nextQuery}`
            : window.location.pathname;
          router.replace(nextUrl, { scroll: false });
        }
      }
    },
    [withSprintContext, router],
  );

  const closeTaskPanel = useCallback(() => {
    // Dialog close events and the close button can arrive in the same commit.
    // Closing is a single URL transition; duplicate transitions could revisit
    // the drawer URL and briefly remount the panel.
    if (isTaskPanelClosingRef.current) return;
    isTaskPanelClosingRef.current = true;
    setEditingTask(null);
    setEditingInitialTab(null);
    loadingInitialOpenTaskRef.current = null;
    if (typeof window !== "undefined") {
      const nextParams = new URLSearchParams(window.location.search);
      const filesReturn = filesReturnQuery(nextParams.get("filesReturn") ?? "");
      if (filesReturn) {
        router.replace(`${window.location.pathname}?${filesReturn}`, { scroll: false });
        return;
      }
      let changed = false;
      for (const key of [
        "drawerType",
        "drawerId",
        "panelTab",
        "commentId",
        "fileId",
      ]) {
        if (nextParams.has(key)) {
          nextParams.delete(key);
          changed = true;
        }
      }
      if (!changed) return;
      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery
        ? `${window.location.pathname}?${nextQuery}`
        : window.location.pathname;

      // Always replace the current drawer URL. Browser Back is not a close
      // primitive here: its previous entry can itself include a drawerId.
      router.replace(nextUrl, { scroll: false });
    }
  }, [router]);

  const handleRenameColumn = useCallback(
    (id: string, newTitle: string) => {
      const updated = workflow.map((column) =>
        column.id === id ? { ...column, title: newTitle } : column,
      );
      void persistWorkflow(updated);
    },
    [persistWorkflow, workflow],
  );

  const handleChangeColor = useCallback(
    (id: string, newColor: SemanticColor) => {
      const updated = workflow.map((column) =>
        column.id === id ? { ...column, accentClassName: newColor } : column,
      );
      void persistWorkflow(updated);
    },
    [persistWorkflow, workflow],
  );

  const handleReorderColumns = useCallback(
    (newOrder: WorkflowColumn[]) => {
      void persistWorkflow(newOrder);
    },
    [persistWorkflow],
  );

  const handleRemoveColumn = useCallback(
    (id: string) => {
      const column = workflow.find((candidate) => candidate.id === id);
      if (column) setColumnPendingDeletion(column);
    },
    [workflow],
  );

  const confirmRemoveColumn = useCallback(async () => {
    if (!columnPendingDeletion || isDeletingColumn) return;
    setIsDeletingColumn(true);
    try {
      const result = await deleteProjectWorkflowColumnAction(
        projectId,
        columnPendingDeletion.id,
      );
      if (!result.success) {
        toast.error(result.error || "Failed to delete section");
        return;
      }
      queryClient.setQueryData(
        workflowQueryKey,
        workflow.filter((column) => column.id !== columnPendingDeletion.id),
      );
      setColumnPendingDeletion(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete section",
      );
    } finally {
      setIsDeletingColumn(false);
    }
  }, [
    columnPendingDeletion,
    isDeletingColumn,
    projectId,
    queryClient,
    workflow,
    workflowQueryKey,
  ]);

  const handleAddColumn = () => {
    setSectionTitle("New section");
    setSectionColor("indigo");
    setSectionStatus("in_progress");
    setAddSectionError(null);
    setIsAddSectionOpen(true);
  };

  const submitNewColumn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = sectionTitle.trim();
    if (!title) {
      setAddSectionError("Enter a section name.");
      return;
    }

    setIsAddingSection(true);
    setAddSectionError(null);
    try {
      const result = await createProjectWorkflowColumnAction({
        projectId,
        title,
        status: sectionStatus,
        accentClassName: sectionColor,
      });
      if (!result.success || !result.column) {
        setAddSectionError(result.error || "Failed to add section");
        return;
      }
      queryClient.setQueryData(workflowQueryKey, [
        ...workflow,
        result.column as WorkflowColumn,
      ]);
      setIsAddSectionOpen(false);
    } catch (error) {
      setAddSectionError(
        error instanceof Error ? error.message : "Failed to add section",
      );
    } finally {
      setIsAddingSection(false);
    }
  };

  // Optimized Filters Hook
  const filteredTasks = sprintAwareTasks;

  useEffect(() => {
    if (isTaskPanelClosingRef.current) return;
    if (
      !initialOpenTaskId ||
      handledInitialOpenTaskRef.current === initialOpenTaskId
    )
      return;
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
      openTask(localTask, initialPanelTab, true);
      onInitialTaskOpened?.();
      return;
    }

    let cancelled = false;
    loadingInitialOpenTaskRef.current = initialOpenTaskId;
    const reportInitialTaskLoadFailure = (reason: unknown) => {
      const detail =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Task detail request failed";
      console.warn("Failed to load initial task", {
        projectId,
        taskId: initialOpenTaskId,
        error: detail,
      });
      const message =
        "Could not open the requested task. It may have been moved, deleted, or unavailable.";
      setInitialTaskLoadError(message);
      toast.error(message);
    };

    void getProjectTaskDetailAction(projectId, initialOpenTaskId)
      .then((result) => {
        if (cancelled || isTaskPanelClosingRef.current) return;
        if (!result.success || !result.task) {
          reportInitialTaskLoadFailure(result.error || "Task was not returned");
          return;
        }
        const normalizedTask = withSprintContext(
          normalizeTaskSurfaceRecord(result.task),
        );
        patchProjectTaskCaches(queryClient, projectId, normalizedTask, {
          reconcile: false,
        });
        setInitialTaskLoadError(null);
        handledInitialOpenTaskRef.current = initialOpenTaskId;
        openTask(normalizedTask, initialPanelTab, true);
        onInitialTaskOpened?.();
      })
      .catch((error) => {
        if (cancelled || isTaskPanelClosingRef.current) return;
        reportInitialTaskLoadFailure(error);
      })
      .finally(() => {
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
    sprintAwareTasks,
    withSprintContext,
    onInitialTaskOpened,
  ]);

  const handleCreateTask = useCallback(
    async (data: any): Promise<{ success: boolean; error?: string }> => {
      setCreateTaskError(null);
      try {
        const result = await createTaskAction(data);

        if (!result.success || !result.task) {
          const error = result.error || "Failed to create task";
          setCreateTaskError(error);
          return { success: false, error };
        }

        const normalizedCreatedTask = withSprintContext(
          normalizeTaskSurfaceRecord(result.task),
        );
        patchProjectTaskCaches(queryClient, projectId, normalizedCreatedTask);
        if (normalizedCreatedTask.sprintId) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
          });
        }
        return { success: true };
      } catch (err) {
        console.error("Exception creating task", err);
        const error = "An error occurred while creating the task";
        setCreateTaskError(error);
        return { success: false, error };
      }
    },
    [projectId, queryClient, withSprintContext],
  );

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
    <div className="space-y-4 flex flex-col min-h-0">
      {/* Header - Hub Header Box Style (Compact) */}
      <div className="w-full max-w-5xl mx-auto shrink-0 -mt-2 mb-6">
        <div className="px-5 py-3 rounded-2xl border shadow-sm border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-shadow duration-300">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                Task Board
              </h2>
              {/* We hide the subtitle here to match the clean Hub Header look, or keep it minimal */}
              <p className="mt-0.5 text-sm text-zinc-500">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {filteredTasks.length}
                </span>{" "}
                {hasNextPage ? " loaded" : " visible"}
                {taskSearchQuery ? (
                  <span>{` matching “${taskSearchQuery}”`}</span>
                ) : null}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Filter */}
              <TaskFilters scope={scope} setScope={setScope} />

              {/* New Section */}
              {canManageWorkflow ? (
                <button
                  onClick={handleAddColumn}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl font-medium transition-[background-color,box-shadow]"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New Section</span>
                </button>
              ) : null}

              {/* New Task - Matches Hub Header Primary Button */}
              {canEditTasks ? (
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
      </div>
      {createTaskError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {createTaskError}
        </div>
      ) : null}

      {workflowQuery.error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {workflowQuery.error instanceof Error
            ? workflowQuery.error.message
            : "Failed to load task workflow"}
        </div>
      ) : null}

      {initialTaskLoadError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {initialTaskLoadError}
        </div>
      ) : null}

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <KanbanBoard
          projectId={projectId}
          workflow={workflow}
          onRenameColumn={handleRenameColumn}
          onChangeColor={handleChangeColor}
          onRemoveColumn={handleRemoveColumn}
          onReorderColumns={handleReorderColumns}
          tasks={filteredTasks}
          onTaskClick={openTask}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          activeAssignableMemberIds={activeAssignableMemberIds}
          isLeader={canManageWorkflow}
          currentUserId={currentUserId}
          onTaskDragStateChange={setRealtimeDeferredTaskId}
        />
      </div>

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
            return handleCreateTask({
              ...payload,
              attachments: value.attachments,
            });
          }}
          projectId={projectId}
          projectName={projectName}
          members={members}
          sprints={sprintOptions}
        />
      ) : null}

      {isAddSectionOpen ? (
        <Dialog open={isAddSectionOpen} onOpenChange={setIsAddSectionOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={submitNewColumn}>
              <DialogHeader>
                <DialogTitle>Add Section</DialogTitle>
                <DialogDescription>
                  Create a new column for your task workflow.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-medium">
                    Name
                  </label>
                  <input
                    id="name"
                    autoFocus
                    value={sectionTitle}
                    onChange={(e) => setSectionTitle(e.target.value)}
                    placeholder="e.g. In Review"
                    className="w-full px-3 py-2 border rounded-md dark:bg-zinc-900 dark:border-zinc-800"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {WORKFLOW_COLORS.map((c) => {
                      const cMap = getColumnColors(c);
                      return (
                        <button
                          type="button"
                          key={c}
                          aria-label={`Use ${c} for the new section`}
                          onClick={() => setSectionColor(c)}
                          className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110",
                            cMap.dot,
                          )}
                        >
                          {sectionColor === c && (
                            <Check className="w-4 h-4 text-white" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="section-status" className="text-sm font-medium">
                    Task state
                  </label>
                  <select
                    id="section-status"
                    value={sectionStatus}
                    onChange={(event) =>
                      setSectionStatus(
                        event.target.value as
                          | "todo"
                          | "in_progress"
                          | "blocked"
                          | "done",
                      )
                    }
                    className="w-full rounded-md border px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <option value="todo">To do</option>
                    <option value="in_progress">In progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                  </select>
                  <p className="text-xs text-zinc-500">
                    Tasks moved into this section inherit this state.
                  </p>
                </div>
                {addSectionError && (
                  <p className="text-sm text-rose-600">{addSectionError}</p>
                )}
              </div>
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setIsAddSectionOpen(false)}
                  className="px-4 py-2 border rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingSection}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
                >
                  {isAddingSection ? "Adding..." : "Add Section"}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {editingTask && (
        <TaskDetailPanel
          task={editingTask}
          onTaskUpdated={(nextTask) => {
            const sprintAwareTask = withSprintContext(
              normalizeTaskSurfaceRecord(nextTask),
            );
            setEditingTask(sprintAwareTask);
            patchProjectTaskCaches(queryClient, projectId, sprintAwareTask, {
              reconcile: false,
            });
          }}
          onClose={closeTaskPanel}
          initialTab={editingInitialTab}
          projectId={projectId}
          projectSlug={projectSlug}
          canEdit={canEditTasks}
          canManageFiles={canManageFiles}
          isOwner={isOwner}
          members={members}
          sprints={sprintOptions}
          currentUserId={currentUserId}
          initialCommentId={initialCommentId}
          initialFileId={initialFileId}
        />
      )}

      <ConfirmDialog
        open={Boolean(columnPendingDeletion)}
        onOpenChange={(open) => {
          if (!open && !isDeletingColumn) setColumnPendingDeletion(null);
        }}
        title="Delete workflow section"
        description={`Delete “${columnPendingDeletion?.title ?? "this section"}”? The section must be empty; move any tasks to another section first.`}
        confirmLabel={isDeletingColumn ? "Deleting..." : "Delete section"}
        variant="destructive"
        onConfirm={confirmRemoveColumn}
      />
    </div>
  );
}
