"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { getTaskAttachments } from "@/app/actions/files/links";
import {
  getProjectTaskDetailAction,
} from "@/app/actions/project";
import {
  createSubtaskAction,
  deleteSubtaskAction,
  toggleSubtaskAction,
  updateSubtaskAction,
} from "@/app/actions/subtask";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import type { ProjectNode } from "@/lib/db/schema";
import {
  mergeTaskSurfaceRecords,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import {
  getTaskFileWarnings,
  summarizeTaskFileWarnings,
  type TaskFileReadinessWarning,
  type TaskLinkedNode,
} from "@/lib/projects/task-file-intelligence";
import type { TaskDiscussionComment } from "@/lib/projects/task-discussion";
import { useTaskDiscussionResource } from "@/hooks/useTaskDiscussionResource";
import {
  useTaskFileMutations,
  type TaskFileUploadStatus,
} from "@/hooks/useTaskFileMutations";
import { useTaskSurfaceMutations } from "@/hooks/useTaskSurfaceMutations";
import { queryKeys } from "@/lib/query-keys";
import { logger } from "@/lib/logger";
import {
  sortTaskSubtasks,
  upsertTaskSubtask,
  type TaskSubtask,
} from "@/lib/projects/task-subtasks";

export type TaskPanelTab =
  | "details"
  | "subtasks"
  | "comments"
  | "files";

export type TaskPanelSubtask = TaskSubtask;

type LoadingState = {
  comments: boolean;
  subtasks: boolean;
  attachments: boolean;
};

type ErrorState = {
  comments: string | null;
  subtasks: string | null;
  attachments: string | null;
};

type CountState = {
  comments: number;
  subtasks: number;
  completedSubtasks: number;
  files: number;
};

type FileWarningState = {
  warnings: TaskFileReadinessWarning[];
  summary: string | null;
};

const PANEL_STALE_TIME_MS = 30_000;

function countsFromTask(task: TaskSurfaceRecord): CountState {
  return {
    comments: task.commentCount ?? 0,
    subtasks: task.subtaskCount ?? 0,
    completedSubtasks: task.completedSubtaskCount ?? 0,
    files: task.fileCount ?? 0,
  };
}

function mergeFileWarnings(...warningSets: TaskFileReadinessWarning[][]) {
  const seen = new Set<string>();
  const merged: TaskFileReadinessWarning[] = [];
  for (const warningSet of warningSets) {
    for (const warning of warningSet) {
      if (seen.has(warning.code)) continue;
      seen.add(warning.code);
      merged.push(warning);
    }
  }
  return merged;
}

function toPanelSubtask(value: Record<string, unknown> | null) {
  if (!value) return null;
  const toIsoDate = (raw: unknown) => {
    if (raw instanceof Date) return raw.toISOString();
    if (typeof raw === "string") {
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return new Date().toISOString();
  };
  return {
    id: String(value.id ?? ""),
    taskId: String(value.task_id ?? value.taskId ?? ""),
    title: String(value.title ?? ""),
    completed: Boolean(value.completed),
    position: Number(value.position ?? 0),
    createdAt: toIsoDate(value.created_at ?? value.createdAt),
    updatedAt: toIsoDate(value.updated_at ?? value.updatedAt),
  } satisfies TaskPanelSubtask;
}

function recordSubtaskMetric(params: {
  action: "load" | "create" | "toggle" | "delete" | "update" | "reconnect";
  status: "success" | "error";
  startedAt: number;
  projectId: string;
  taskId: string;
  count?: number;
}) {
  logger.metric("task_panel.subtask", {
    module: "task-panel",
    action: params.action,
    status: params.status,
    durationMs: Date.now() - params.startedAt,
    projectId: params.projectId,
    taskId: params.taskId,
    count: params.count,
  });
}

function commentCountDelta(
  eventType: string | undefined,
  current: Record<string, unknown> | null,
  previous: Record<string, unknown> | null,
) {
  const currentActive = Boolean(current) && !current?.deleted_at;
  const previousActive = Boolean(previous) && !previous?.deleted_at;
  if (eventType === "INSERT") return currentActive ? 1 : 0;
  if (eventType === "DELETE") return previousActive ? -1 : 0;
  if (eventType === "UPDATE") return Number(currentActive) - Number(previousActive);
  return 0;
}

export function useTaskPanelResource(params: {
  task: TaskSurfaceRecord | any;
  projectId: string;
  activeTab?: TaskPanelTab;
  currentUserId?: string;
  canEdit?: boolean;
  sprints?: any[];
  members?: any[];
  onTaskUpdated?: (task: TaskSurfaceRecord) => void;
}) {
  const {
    task: initialTask,
    projectId,
    activeTab = "details",
    currentUserId,
    canEdit = false,
    sprints = [],
    members = [],
    onTaskUpdated,
  } = params;
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { isConnected } = useRealtime();

  const [task, setTask] = useState<TaskSurfaceRecord>(() =>
    normalizeTaskSurfaceRecord(initialTask),
  );
  const taskForCountsRef = useRef(task);
  taskForCountsRef.current = task;
  const [counts, setCounts] = useState<CountState>(() =>
    countsFromTask(normalizeTaskSurfaceRecord(initialTask)),
  );
  const [subtasks, setSubtasks] = useState<TaskPanelSubtask[]>([]);
  const [attachments, setAttachments] = useState<ProjectNode[]>([]);
  const [fileWarningState, setFileWarningState] = useState<FileWarningState>({
    warnings: [],
    summary: null,
  });
  const [isResourceConnected, setIsResourceConnected] = useState(true);
  const [loading, setLoading] = useState<LoadingState>({
    comments: false,
    subtasks: true,
    attachments: true,
  });
  const [errors, setErrors] = useState<ErrorState>({
    comments: null,
    subtasks: null,
    attachments: null,
  });
  const [loadedDeferredTabs, setLoadedDeferredTabs] = useState({
    comments: false,
    subtasks: false,
    files: false,
  });
  const loadedTabs = useMemo<Record<TaskPanelTab, boolean>>(
    () => ({
      details: true,
      subtasks: loadedDeferredTabs.subtasks,
      comments: loadedDeferredTabs.comments,
      files: loadedDeferredTabs.files,
    }),
    [
      loadedDeferredTabs.comments,
      loadedDeferredTabs.subtasks,
      loadedDeferredTabs.files,
    ],
  );

  const refreshTimersRef = useRef<
    Partial<Record<"attachments", ReturnType<typeof setTimeout>>>
  >({});
  const lastAttachmentRefreshAtRef = useRef(0);
  const resourceConnectedRef = useRef(true); // ponytail optimistic: avoid 1.5s visual flash while channel joins
  const resourceDisconnectedAtRef = useRef<number | null>(null);
  const loadedTabsRef = useRef(loadedTabs);
  const taskIdRef = useRef(task.id);
  const onTaskUpdatedRef = useRef(onTaskUpdated);

  useEffect(() => {
    onTaskUpdatedRef.current = onTaskUpdated;
  }, [onTaskUpdated]);

  useEffect(() => {
    loadedTabsRef.current = loadedTabs;
  }, [loadedTabs]);

  useEffect(() => {
    const nextTask = normalizeTaskSurfaceRecord(initialTask);
    const changedTask = taskIdRef.current !== nextTask.id;
    setTask((current) =>
      changedTask
        ? nextTask
        : {
            ...nextTask,
            commentCount: current.commentCount,
            subtaskCount: current.subtaskCount,
            completedSubtaskCount: current.completedSubtaskCount,
            fileCount: current.fileCount,
          },
    );
    if (changedTask) {
      taskIdRef.current = nextTask.id;
      const nextLoadedTabs = {
        details: true,
        subtasks: false,
        comments: false,
        files: false,
      } satisfies Record<TaskPanelTab, boolean>;
      loadedTabsRef.current = nextLoadedTabs;
      setLoadedDeferredTabs({
        comments: false,
        subtasks: false,
        files: false,
      });
      setSubtasks([]);
      setAttachments([]);
      setCounts(countsFromTask(nextTask));
      setErrors({
        comments: null,
        subtasks: null,
        attachments: null,
      });
    }
  }, [initialTask]);

  useEffect(() => {
    setTask((current) =>
      current.commentCount === counts.comments &&
      current.subtaskCount === counts.subtasks &&
      current.completedSubtaskCount === counts.completedSubtasks &&
      current.fileCount === counts.files
        ? current
        : {
            ...current,
            commentCount: counts.comments,
            subtaskCount: counts.subtasks,
            completedSubtaskCount: counts.completedSubtasks,
            fileCount: counts.files,
          },
    );
  }, [counts]);

  useEffect(() => {
    // Keep task cards and the details summary on the same completion totals.
    onTaskUpdatedRef.current?.({
      ...taskForCountsRef.current,
      commentCount: counts.comments,
      subtaskCount: counts.subtasks,
      completedSubtaskCount: counts.completedSubtasks,
      fileCount: counts.files,
    });
  }, [
    counts.comments,
    counts.completedSubtasks,
    counts.files,
    counts.subtasks,
  ]);

  const clearError = useCallback((section: keyof ErrorState) => {
    setErrors((current) => ({ ...current, [section]: null }));
  }, []);

  const replaceSubtasks = useCallback(
    (updater: (current: TaskPanelSubtask[]) => TaskPanelSubtask[]) => {
      setSubtasks((current) => {
        const next = updater(current);
        setCounts((counts) => ({
          ...counts,
          subtasks: next.length,
          completedSubtasks: next.filter((subtask) => subtask.completed).length,
        }));
        return next;
      });
    },
    [],
  );

  const loadSubtasks = useCallback(async () => {
    const requestedTaskId = task.id;
    const startedAt = Date.now();
    setLoading((current) => ({ ...current, subtasks: true }));
    clearError("subtasks");

    try {
      const mapped = await queryClient.fetchQuery({
        queryKey: queryKeys.project.detail.taskPanel(
          projectId,
          task.id,
          "subtasks",
        ),
        staleTime: PANEL_STALE_TIME_MS,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("task_subtasks")
            .select("id, task_id, title, completed, position, created_at, updated_at")
            .eq("task_id", task.id)
            .order("position", { ascending: true })
            .order("id", { ascending: true })
            .range(0, 199);
          if (error) throw error;
          const rows = (data ?? []) as Record<string, unknown>[];
          return sortTaskSubtasks(
            rows
              .map((subtask) => toPanelSubtask(subtask))
              .filter((subtask): subtask is TaskPanelSubtask => Boolean(subtask)),
          );
        },
      });
      if (taskIdRef.current !== requestedTaskId) return [];
      setSubtasks(mapped);
      setCounts((current) => ({
        ...current,
        subtasks: mapped.length,
        completedSubtasks: mapped.filter((subtask) => subtask.completed).length,
      }));
      recordSubtaskMetric({
        action: "load",
        status: "success",
        startedAt,
        projectId,
        taskId: task.id,
        count: mapped.length,
      });
      return mapped;
    } catch (error) {
      if (taskIdRef.current !== requestedTaskId) return [];
      const message =
        error instanceof Error ? error.message : "Failed to load subtasks";
      setErrors((current) => ({ ...current, subtasks: message }));
      recordSubtaskMetric({
        action: "load",
        status: "error",
        startedAt,
        projectId,
        taskId: task.id,
      });
      return [] as TaskPanelSubtask[];
    } finally {
      if (taskIdRef.current === requestedTaskId) {
        setLoading((current) => ({ ...current, subtasks: false }));
      }
    }
  }, [clearError, projectId, queryClient, supabase, task.id]);

  const loadAttachments = useCallback(async () => {
    const requestedTaskId = task.id;
    setLoading((current) => ({ ...current, attachments: true }));
    clearError("attachments");

    try {
      const nodes = await queryClient.fetchQuery({
        queryKey: queryKeys.project.detail.taskPanel(
          projectId,
          task.id,
          "files",
        ),
        staleTime: PANEL_STALE_TIME_MS,
        queryFn: () =>
          getTaskAttachments(projectId, task.id) as Promise<ProjectNode[]>,
      });
      if (taskIdRef.current !== requestedTaskId) return [];
      const nextAttachments = Array.isArray(nodes) ? nodes : [];
      setAttachments(nextAttachments);
      setCounts((current) => ({ ...current, files: nextAttachments.length }));
      return nextAttachments;
    } catch (error) {
      if (taskIdRef.current !== requestedTaskId) return [];
      const message =
        error instanceof Error ? error.message : "Failed to load files";
      setErrors((current) => ({ ...current, attachments: message }));
      return [] as ProjectNode[];
    } finally {
      if (taskIdRef.current === requestedTaskId) {
        setLoading((current) => ({ ...current, attachments: false }));
      }
    }
  }, [clearError, projectId, queryClient, task.id]);

  const refreshAttachments = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.project.detail.taskPanel(
        projectId,
        task.id,
        "files",
      ),
      refetchType: "none",
    });
    const result = await loadAttachments();
    lastAttachmentRefreshAtRef.current = Date.now();
    return result;
  }, [loadAttachments, projectId, queryClient, task.id]);

  const loadTask = useCallback(async () => {
    const requestedTaskId = task.id;
    const result = await getProjectTaskDetailAction(projectId, task.id);
    if (taskIdRef.current !== requestedTaskId) return;
    if (!result.success || !result.task) return;
    setTask((current) => {
      const nextTask = mergeTaskSurfaceRecords(
        current,
        normalizeTaskSurfaceRecord(result.task),
      );
      nextTask.newSubtaskCount = current.newSubtaskCount;
      nextTask.newCommentCount = current.newCommentCount;
      nextTask.newFileCount = current.newFileCount;
      onTaskUpdatedRef.current?.(nextTask);
      return nextTask;
    });
  }, [projectId, task.id]);

  const scheduleRefresh = useCallback(
    (section: "attachments") => {
      if (refreshTimersRef.current[section]) {
        clearTimeout(refreshTimersRef.current[section]);
      }

      refreshTimersRef.current[section] = setTimeout(() => {
        refreshTimersRef.current[section] = undefined;
        if (Date.now() - lastAttachmentRefreshAtRef.current < 500) return;
        void refreshAttachments();
      }, 120);
    },
    [refreshAttachments],
  );

  const discussion = useTaskDiscussionResource({
    taskId: task.id,
    projectId,
    canEdit,
    currentUserId,
    enabled: activeTab === "comments",
  });

  const ensureTabLoaded = useCallback(
    async (tab: TaskPanelTab) => {
      const alreadyLoaded = loadedTabsRef.current[tab];
      if (
        tab === "comments" ||
        tab === "subtasks" ||
        tab === "files"
      ) {
        loadedTabsRef.current = {
          ...loadedTabsRef.current,
          [tab]: true,
        };
        setLoadedDeferredTabs((current) => {
          if (current[tab]) return current;
          return { ...current, [tab]: true };
        });
      }

      if (
        alreadyLoaded &&
        !(
          (tab === "subtasks" && errors.subtasks) ||
          (tab === "comments" && errors.comments) ||
          (tab === "files" && errors.attachments)
        )
      ) {
        return;
      }

      if (tab === "details") return;
      if (tab === "subtasks") {
        await loadSubtasks();
        return;
      }
      if (tab === "files") {
        await loadAttachments();
        return;
      }
      if (tab === "comments") {
        await discussion.loadDiscussion();
        return;
      }
    },
    [
      discussion.loadDiscussion,
      errors,
      loadAttachments,
      loadSubtasks,
    ],
  );

  useEffect(() => {
    const unsubscribe = subscribeTaskResource({
      taskId: task.id,
      onEvent: (event) => {
        const eventType = event.payload.eventType;

        if (event.kind === "task") {
          if (eventType !== "DELETE") void loadTask();
          return;
        }

        if (event.kind === "subtask") {
          const nextPayload = toPanelSubtask(
            event.payload.new as Record<string, unknown> | null,
          );
          const previousPayload = toPanelSubtask(
            event.payload.old as Record<string, unknown> | null,
          );

          if (loadedTabsRef.current.subtasks) {
            replaceSubtasks((current) => {
              let next = current;
              if (eventType === "INSERT" && nextPayload) {
                next = upsertTaskSubtask(current, nextPayload);
              } else if (eventType === "UPDATE" && nextPayload) {
                next = upsertTaskSubtask(current, nextPayload);
              } else if (eventType === "DELETE" && previousPayload?.id) {
                next = current.filter(
                  (subtask) => subtask.id !== previousPayload.id,
                );
              }
              return next;
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.project.detail.taskPanel(
                projectId,
                task.id,
                "subtasks",
              ),
              refetchType: "none",
            });
          } else {
            setCounts((current) => {
              const totalDelta = eventType === "INSERT" ? 1 : eventType === "DELETE" ? -1 : 0;
              const completedDelta =
                eventType === "INSERT"
                  ? Number(nextPayload?.completed)
                  : eventType === "DELETE"
                    ? -Number(previousPayload?.completed)
                    : eventType === "UPDATE"
                      ? Number(nextPayload?.completed) - Number(previousPayload?.completed)
                      : 0;
              return {
                ...current,
                subtasks: Math.max(0, current.subtasks + totalDelta),
                completedSubtasks: Math.max(
                  0,
                  current.completedSubtasks + completedDelta,
                ),
              };
            });
          }

          return;
        }

        if (event.kind === "comment") {
          const nextPayload = event.payload.new as Record<
            string,
            unknown
          > | null;
          const previousPayload = event.payload.old as Record<
            string,
            unknown
          > | null;

          const delta = commentCountDelta(
            eventType,
            nextPayload,
            previousPayload,
          );
          if (!loadedTabsRef.current.comments && delta !== 0) {
            setCounts((current) => ({
              ...current,
              comments: Math.max(0, current.comments + delta),
            }));
          }

          return;
        }

        if (event.kind === "attachment_link") {
          const nextPayload = event.payload.new as Record<
            string,
            unknown
          > | null;
          const previousPayload = event.payload.old as Record<
            string,
            unknown
          > | null;
          const nextTaskId =
            typeof nextPayload?.task_id === "string"
              ? nextPayload.task_id
              : null;
          const previousTaskId =
            typeof previousPayload?.task_id === "string"
              ? previousPayload.task_id
              : null;

          if (loadedTabsRef.current.files) {
            scheduleRefresh("attachments");
          } else if (eventType === "INSERT" && nextTaskId === task.id) {
            setCounts((current) => ({ ...current, files: current.files + 1 }));
          } else if (eventType === "DELETE" && previousTaskId === task.id) {
            setCounts((current) => ({
              ...current,
              files: Math.max(0, current.files - 1),
            }));
          }
        }
      },
      onStatus: (status) => {
        if (status === "SUBSCRIBED") {
          const reconnected = !resourceConnectedRef.current;
          const disconnectedAt = resourceDisconnectedAtRef.current;
          resourceConnectedRef.current = true;
          resourceDisconnectedAtRef.current = null;
          setIsResourceConnected(true);
          if (reconnected && disconnectedAt !== null) {
            recordSubtaskMetric({
              action: "reconnect",
              status: "success",
              startedAt: disconnectedAt,
              projectId,
              taskId: task.id,
            });
          }
        } else if (
          status === "CLOSED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT"
        ) {
          resourceConnectedRef.current = false;
          resourceDisconnectedAtRef.current ??= Date.now();
          setIsResourceConnected(false);
        }
      },
    });

    return () => {
      unsubscribe();
      for (const timer of Object.values(refreshTimersRef.current)) {
        if (timer) clearTimeout(timer);
      }
      resourceConnectedRef.current = false;
      resourceDisconnectedAtRef.current = null;
    };
  }, [
    loadTask,
    projectId,
    queryClient,
    replaceSubtasks,
    scheduleRefresh,
    task.id,
  ]);

  useEffect(() => {
    const cleanup = createVisibilityAwareInterval(() => {
      if (isConnected && resourceConnectedRef.current) {
        return;
      }

      if (loadedTabsRef.current.subtasks) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.taskPanel(
            projectId,
            task.id,
            "subtasks",
          ),
          refetchType: "none",
        });
        void loadSubtasks();
      }
      if (loadedTabsRef.current.files) {
        void refreshAttachments();
      }
    }, 30_000);

    return () => {
      cleanup();
    };
  }, [
    isConnected,
    loadSubtasks,
    projectId,
    queryClient,
    refreshAttachments,
    task.id,
  ]);

  useEffect(() => {
    setLoading((current) => ({ ...current, comments: discussion.isLoading }));
    setErrors((current) => ({ ...current, comments: discussion.error }));
    if (!discussion.isLoaded) return;
    setCounts((current) =>
      current.comments === discussion.totalCount
        ? current
        : { ...current, comments: discussion.totalCount },
    );
  }, [
    discussion.error,
    discussion.isLoaded,
    discussion.isLoading,
    discussion.totalCount,
  ]);

  const taskMutations = useTaskSurfaceMutations({
    task,
    projectId,
    attachments,
    sprints,
    members,
    onTaskChange: (nextTask) => {
      setTask(nextTask);
      onTaskUpdated?.(nextTask);
    },
  });

  const {
    uploadQueue,
    isUploading,
    pendingResolution,
    unresolvedReplacementCount,
    unclassifiedUploadCount,
    uploadFiles,
    uploadFolders,
    unlinkAttachment,
    resolvePendingResolution,
    saveAsNewVersion,
    downloadAttachment,
  } = useTaskFileMutations({
    projectId,
    taskId: task.id,
    canEdit,
    enabled: loadedTabs.files,
    attachments,
    setAttachments,
    refreshAttachments,
    onError: (message) =>
      setErrors((current) => ({ ...current, attachments: message })),
    onAfterMutation: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
      });
    },
  });

  useEffect(() => {
    const derivedWarnings = getTaskFileWarnings({
      status: task.status,
      attachments: attachments as TaskLinkedNode[],
      fileCount: counts.files,
      unresolvedReplacement: unresolvedReplacementCount > 0,
      unclassifiedUpload: unclassifiedUploadCount > 0,
    });

    const warnings = mergeFileWarnings(
      taskMutations.statusWarnings,
      derivedWarnings,
    );
    setFileWarningState({
      warnings,
      summary: summarizeTaskFileWarnings(warnings),
    });
  }, [
    attachments,
    task.status,
    taskMutations.statusWarnings,
    counts.files,
    unclassifiedUploadCount,
    unresolvedReplacementCount,
  ]);

  const addSubtask = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        const error = "Subtask title is required";
        setErrors((current) => ({ ...current, subtasks: error }));
        return { success: false as const, error };
      }

      clearError("subtasks");
      const startedAt = Date.now();
      const result = await createSubtaskAction(task.id, trimmed, projectId);
      recordSubtaskMetric({
        action: "create",
        status: result.success ? "success" : "error",
        startedAt,
        projectId,
        taskId: task.id,
      });
      if (!result.success) {
        const error = result.error || "Failed to add subtask";
        setErrors((current) => ({ ...current, subtasks: error }));
        return { success: false as const, error };
      }

      const nextSubtask = toPanelSubtask(result.data as Record<string, unknown>) ?? {
        id: "",
        taskId: task.id,
        title: trimmed,
        completed: false,
        position: Number.MAX_SAFE_INTEGER,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      replaceSubtasks((current) => upsertTaskSubtask(current, nextSubtask));

      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.taskPanel(
          projectId,
          task.id,
          "subtasks",
        ),
        refetchType: "none",
      });
      return { success: true as const };
    },
    [clearError, projectId, queryClient, replaceSubtasks, task.id],
  );

  const toggleSubtask = useCallback(
    async (subtaskId: string, completed: boolean) => {
      clearError("subtasks");
      const startedAt = Date.now();
      replaceSubtasks((current) =>
        current.map((subtask) =>
          subtask.id === subtaskId
            ? { ...subtask, completed: !completed, updatedAt: new Date().toISOString() }
            : subtask,
        ),
      );

      const result = await toggleSubtaskAction(
        subtaskId,
        !completed,
        projectId,
      );
      recordSubtaskMetric({
        action: "toggle",
        status: result.success ? "success" : "error",
        startedAt,
        projectId,
        taskId: task.id,
      });
      if (!result.success) {
        const error = result.error || "Failed to update subtask";
        setErrors((current) => ({ ...current, subtasks: error }));
        void loadSubtasks();
        return { success: false as const, error };
      }

      const updated = toPanelSubtask(result.data as Record<string, unknown>);
      if (updated) replaceSubtasks((current) => upsertTaskSubtask(current, updated));

      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.taskPanel(
          projectId,
          task.id,
          "subtasks",
        ),
        refetchType: "none",
      });
      return { success: true as const };
    },
    [clearError, loadSubtasks, projectId, queryClient, replaceSubtasks, task.id],
  );

  const removeSubtask = useCallback(
    async (subtaskId: string) => {
      clearError("subtasks");
      const startedAt = Date.now();
      replaceSubtasks((current) =>
        current.filter((subtask) => subtask.id !== subtaskId),
      );

      const result = await deleteSubtaskAction(subtaskId, projectId);
      recordSubtaskMetric({
        action: "delete",
        status: result.success ? "success" : "error",
        startedAt,
        projectId,
        taskId: task.id,
      });
      if (!result.success) {
        const error = result.error || "Failed to delete subtask";
        setErrors((current) => ({ ...current, subtasks: error }));
        void loadSubtasks();
        return { success: false as const, error };
      }

      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.taskPanel(
          projectId,
          task.id,
          "subtasks",
        ),
        refetchType: "none",
      });
      return { success: true as const };
    },
    [clearError, loadSubtasks, projectId, queryClient, replaceSubtasks, task.id],
  );

  const updateSubtask = useCallback(
    async (subtaskId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        const error = "Subtask title is required";
        setErrors((current) => ({ ...current, subtasks: error }));
        return { success: false as const, error };
      }

      clearError("subtasks");
      const startedAt = Date.now();
      replaceSubtasks((current) =>
        current.map((subtask) =>
          subtask.id === subtaskId
            ? { ...subtask, title: trimmed, updatedAt: new Date().toISOString() }
            : subtask,
        ),
      );
      const result = await updateSubtaskAction(subtaskId, trimmed, projectId);
      recordSubtaskMetric({
        action: "update",
        status: result.success ? "success" : "error",
        startedAt,
        projectId,
        taskId: task.id,
      });
      if (!result.success) {
        const error = result.error || "Failed to update subtask";
        setErrors((current) => ({ ...current, subtasks: error }));
        void loadSubtasks();
        return { success: false as const, error };
      }

      const updated = toPanelSubtask(result.data as Record<string, unknown>);
      if (updated) replaceSubtasks((current) => upsertTaskSubtask(current, updated));
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.taskPanel(projectId, task.id, "subtasks"),
        refetchType: "none",
      });
      return { success: true as const };
    },
    [clearError, loadSubtasks, projectId, queryClient, replaceSubtasks, task.id],
  );

  const commentTyping = useMemo(
    () => ({
      topLevel: discussion.topLevelTypingUsers,
      repliesByParentId: discussion.replyTypingUsersByParentId,
    }),
    [discussion.topLevelTypingUsers, discussion.replyTypingUsersByParentId],
  );

  const fileMutations = useMemo(
    () => ({
      uploadQueue: uploadQueue as TaskFileUploadStatus[],
      isUploading,
      uploadFiles,
      uploadFolders,
      unlinkAttachment,
      pendingResolution,
      resolvePendingResolution,
      saveAsNewVersion,
      downloadAttachment,
    }),
    [
      uploadQueue,
      isUploading,
      uploadFiles,
      uploadFolders,
      unlinkAttachment,
      pendingResolution,
      resolvePendingResolution,
      saveAsNewVersion,
      downloadAttachment,
    ],
  );

  return useMemo(
    () => ({
      task,
      counts,
      comments: discussion.comments as TaskDiscussionComment[],
      subtasks,
      attachments,
      fileWarnings: fileWarningState.warnings,
      fileWarningSummary: fileWarningState.summary,
      loading,
      errors,
      loadedTabs,
      isRealtimeConnected: isConnected && isResourceConnected,
      discussionPresenceStatus: discussion.presenceStatus,
      commentNextCursor: discussion.nextCursor,
      commentLoadingMore: discussion.isLoadingMore,
      commentTyping,
      ensureTabLoaded,
      clearError,
      taskMutations,
      addComment: discussion.addComment,
      toggleCommentLike: discussion.toggleLike,
      deleteComment: discussion.deleteComment,
      addSubtask,
      toggleSubtask,
      removeSubtask,
      updateSubtask,
      loadComments: discussion.loadDiscussion,
      loadOlderComments: discussion.loadOlderComments,
      sendCommentTyping: discussion.sendTyping,
      loadSubtasks,
      loadAttachments: refreshAttachments,
      refreshTask: loadTask,
      fileMutations,
    }),
    [
      task,
      counts,
      discussion.comments,
      subtasks,
      attachments,
      fileWarningState.warnings,
      fileWarningState.summary,
      loading,
      errors,
      loadedTabs,
      isConnected,
      isResourceConnected,
      discussion.presenceStatus,
      discussion.nextCursor,
      discussion.isLoadingMore,
      commentTyping,
      ensureTabLoaded,
      clearError,
      taskMutations,
      discussion.addComment,
      discussion.toggleLike,
      discussion.deleteComment,
      addSubtask,
      toggleSubtask,
      removeSubtask,
      updateSubtask,
      discussion.loadDiscussion,
      discussion.loadOlderComments,
      discussion.sendTyping,
      loadSubtasks,
      refreshAttachments,
      loadTask,
      fileMutations,
    ],
  );
}
