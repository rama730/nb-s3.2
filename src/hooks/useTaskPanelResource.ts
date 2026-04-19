"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { countTaskAttachments, getTaskAttachments } from "@/app/actions/files";
import { getProjectTaskActivityAction } from "@/app/actions/project";
import { createSubtaskAction, deleteSubtaskAction, toggleSubtaskAction } from "@/app/actions/subtask";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import type { ProjectNode } from "@/lib/db/schema";
import {
  normalizeTaskSurfaceRecord,
  type TaskActivityItem,
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
import { useTaskFileMutations, type TaskFileUploadStatus } from "@/hooks/useTaskFileMutations";
import { useTaskSurfaceMutations } from "@/hooks/useTaskSurfaceMutations";

export type TaskPanelTab = "details" | "subtasks" | "comments" | "files" | "activity";

export type TaskPanelSubtask = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type LoadingState = {
  counts: boolean;
  comments: boolean;
  subtasks: boolean;
  attachments: boolean;
  activity: boolean;
};

type ErrorState = {
  comments: string | null;
  subtasks: string | null;
  attachments: string | null;
  activity: string | null;
};

type CountState = {
  comments: number;
  subtasks: number;
  files: number;
};

type FileWarningState = {
  warnings: TaskFileReadinessWarning[];
  summary: string | null;
};

const EMPTY_COUNTS: CountState = {
  comments: 0,
  subtasks: 0,
  files: 0,
};

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

function sortSubtasks(items: TaskPanelSubtask[]) {
  return [...items].sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
}

function shouldIncrementCount(eventType: string | undefined) {
  return eventType === "INSERT" ? 1 : eventType === "DELETE" ? -1 : 0;
}

export function useTaskPanelResource(params: {
  task: TaskSurfaceRecord | any;
  projectId: string;
  currentUserId?: string;
  canEdit?: boolean;
  sprints?: any[];
  members?: any[];
  onTaskUpdated?: (task: TaskSurfaceRecord) => void;
}) {
  const {
    task: initialTask,
    projectId,
    currentUserId,
    canEdit = false,
    sprints = [],
    members = [],
    onTaskUpdated,
  } = params;
  const supabase = useMemo(() => createClient(), []);
  const { isConnected } = useRealtime();

  const [task, setTask] = useState<TaskSurfaceRecord>(() => normalizeTaskSurfaceRecord(initialTask));
  const [counts, setCounts] = useState<CountState>(EMPTY_COUNTS);
  const [subtasks, setSubtasks] = useState<TaskPanelSubtask[]>([]);
  const [attachments, setAttachments] = useState<ProjectNode[]>([]);
  const [activity, setActivity] = useState<TaskActivityItem[]>([]);
  const [fileWarningState, setFileWarningState] = useState<FileWarningState>({
    warnings: [],
    summary: null,
  });
  const [loading, setLoading] = useState<LoadingState>({
    counts: true,
    comments: false,
    subtasks: true,
    attachments: true,
    activity: false,
  });
  const [errors, setErrors] = useState<ErrorState>({
    comments: null,
    subtasks: null,
    attachments: null,
    activity: null,
  });
  const [loadedTabs, setLoadedTabs] = useState<Record<TaskPanelTab, boolean>>({
    details: true,
    subtasks: true,
    comments: false,
    files: true,
    activity: false,
  });

  const refreshTimersRef = useRef<Partial<Record<"attachments" | "activity", ReturnType<typeof setTimeout>>>>({});
  const resourceConnectedRef = useRef(false);
  const loadedTabsRef = useRef(loadedTabs);

  useEffect(() => {
    loadedTabsRef.current = loadedTabs;
  }, [loadedTabs]);

  useEffect(() => {
    setTask(normalizeTaskSurfaceRecord(initialTask));
  }, [initialTask]);

  const clearError = useCallback((section: keyof ErrorState) => {
    setErrors((current) => ({ ...current, [section]: null }));
  }, []);

  const loadCounts = useCallback(async () => {
    setLoading((current) => ({ ...current, counts: true }));
    try {
      const [subtasksCount, commentsCount, filesCount] = await Promise.all([
        supabase.from("task_subtasks").select("*", { count: "exact", head: true }).eq("task_id", task.id),
        supabase.from("task_comments").select("*", { count: "exact", head: true }).eq("task_id", task.id),
        countTaskAttachments(task.id),
      ]);

      setCounts({
        subtasks: subtasksCount.count || 0,
        comments: commentsCount.count || 0,
        files: filesCount || 0,
      });
    } finally {
      setLoading((current) => ({ ...current, counts: false }));
    }
  }, [supabase, task.id]);

  const loadSubtasks = useCallback(async () => {
    setLoading((current) => ({ ...current, subtasks: true }));
    clearError("subtasks");

    try {
      const { data, error } = await supabase
        .from("task_subtasks")
        .select("*")
        .eq("task_id", task.id)
        .order("position", { ascending: true });

      if (error) throw error;

      const mapped = sortSubtasks((data ?? []) as TaskPanelSubtask[]);
      setSubtasks(mapped);
      setCounts((current) => ({ ...current, subtasks: mapped.length }));
      return mapped;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load subtasks";
      setErrors((current) => ({ ...current, subtasks: message }));
      return [] as TaskPanelSubtask[];
    } finally {
      setLoading((current) => ({ ...current, subtasks: false }));
    }
  }, [clearError, supabase, task.id]);

  const loadAttachments = useCallback(async () => {
    setLoading((current) => ({ ...current, attachments: true }));
    clearError("attachments");

    try {
      const nodes = (await getTaskAttachments(task.id)) as ProjectNode[];
      const nextAttachments = Array.isArray(nodes) ? nodes : [];
      setAttachments(nextAttachments);
      setCounts((current) => ({ ...current, files: nextAttachments.length }));
      return nextAttachments;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load files";
      setErrors((current) => ({ ...current, attachments: message }));
      return [] as ProjectNode[];
    } finally {
      setLoading((current) => ({ ...current, attachments: false }));
    }
  }, [clearError, task.id]);

  const loadActivity = useCallback(async () => {
    setLoading((current) => ({ ...current, activity: true }));
    clearError("activity");

    try {
      const result = await getProjectTaskActivityAction(projectId, task.id, 40);
      if (!result.success) {
        throw new Error(result.error || "Failed to load activity");
      }

      setActivity(result.items);
      return result.items;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load activity";
      setErrors((current) => ({ ...current, activity: message }));
      return [] as TaskActivityItem[];
    } finally {
      setLoading((current) => ({ ...current, activity: false }));
    }
  }, [clearError, projectId, task.id]);

  const scheduleRefresh = useCallback((section: "attachments" | "activity") => {
    if (refreshTimersRef.current[section]) {
      clearTimeout(refreshTimersRef.current[section]);
    }

    refreshTimersRef.current[section] = setTimeout(() => {
      refreshTimersRef.current[section] = undefined;
      if (section === "attachments") {
        void loadAttachments();
      } else {
        void loadActivity();
      }
    }, 120);
  }, [loadActivity, loadAttachments]);

  const discussion = useTaskDiscussionResource({
    taskId: task.id,
    projectId,
    canEdit,
    currentUserId,
    enabled: loadedTabs.comments,
  });

  const ensureTabLoaded = useCallback(async (tab: TaskPanelTab) => {
    const alreadyLoaded = loadedTabsRef.current[tab];
    setLoadedTabs((current) => {
      if (current[tab]) return current;
      return { ...current, [tab]: true };
    });

    if (alreadyLoaded) {
      return;
    }

    if (tab === "details" || tab === "subtasks") {
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
    if (tab === "activity") {
      await loadActivity();
    }
  }, [discussion.loadDiscussion, loadActivity, loadAttachments, loadSubtasks]);

  useEffect(() => {
    void Promise.all([loadCounts(), loadSubtasks(), loadAttachments()]);
  }, [loadAttachments, loadCounts, loadSubtasks]);

  useEffect(() => {
    const unsubscribe = subscribeTaskResource({
      taskId: task.id,
      onEvent: (event) => {
        const eventType = event.payload.eventType;

        if (event.kind === "subtask") {
          if (loadedTabsRef.current.details || loadedTabsRef.current.subtasks) {
            const nextPayload = event.payload.new
              ? sortSubtasks([
                  {
                    id: String((event.payload.new as any).id ?? ""),
                    taskId: String((event.payload.new as any).task_id ?? ""),
                    title: String((event.payload.new as any).title ?? ""),
                    completed: Boolean((event.payload.new as any).completed),
                    position: Number((event.payload.new as any).position ?? 0),
                    createdAt: new Date((event.payload.new as any).created_at ?? new Date()).toISOString(),
                    updatedAt: new Date((event.payload.new as any).updated_at ?? new Date()).toISOString(),
                  },
                ])[0]
              : null;
            const previousPayload = event.payload.old
              ? {
                  id: String((event.payload.old as any).id ?? ""),
                  taskId: String((event.payload.old as any).task_id ?? ""),
                  title: String((event.payload.old as any).title ?? ""),
                  completed: Boolean((event.payload.old as any).completed),
                  position: Number((event.payload.old as any).position ?? 0),
                  createdAt: new Date((event.payload.old as any).created_at ?? new Date()).toISOString(),
                  updatedAt: new Date((event.payload.old as any).updated_at ?? new Date()).toISOString(),
                }
              : null;

            setSubtasks((current) => {
              if (eventType === "INSERT" && nextPayload) {
                if (current.some((subtask) => subtask.id === nextPayload.id)) return current;
                return sortSubtasks([...current, nextPayload]);
              }

              if (eventType === "UPDATE" && nextPayload) {
                return sortSubtasks(current.map((subtask) => (subtask.id === nextPayload.id ? nextPayload : subtask)));
              }

              if (eventType === "DELETE" && previousPayload?.id) {
                return current.filter((subtask) => subtask.id !== previousPayload.id);
              }

              return current;
            });
          }

          const delta = shouldIncrementCount(eventType);
          if (delta !== 0) {
            setCounts((current) => ({
              ...current,
              subtasks: Math.max(0, current.subtasks + delta),
            }));
          }

          if (loadedTabsRef.current.activity) {
            scheduleRefresh("activity");
          }
          return;
        }

        if (event.kind === "comment") {
          const nextPayload = event.payload.new as Record<string, unknown> | null;
          const previousPayload = event.payload.old as Record<string, unknown> | null;

          const delta = shouldIncrementCount(eventType);
          if (!loadedTabsRef.current.comments && delta !== 0) {
            setCounts((current) => ({
              ...current,
              comments: Math.max(0, current.comments + delta),
            }));
          }

          if (loadedTabsRef.current.activity && eventType === "INSERT") {
            scheduleRefresh("activity");
          }
          return;
        }

        if (event.kind === "attachment_link") {
          const nextPayload = event.payload.new as Record<string, unknown> | null;
          const previousPayload = event.payload.old as Record<string, unknown> | null;
          const nextTaskId = typeof nextPayload?.task_id === "string" ? nextPayload.task_id : null;
          const previousTaskId = typeof previousPayload?.task_id === "string" ? previousPayload.task_id : null;

          if (eventType === "INSERT" && nextTaskId === task.id) {
            setCounts((current) => ({ ...current, files: current.files + 1 }));
          } else if (eventType === "DELETE" && previousTaskId === task.id) {
            setCounts((current) => ({ ...current, files: Math.max(0, current.files - 1) }));
          }

          if (loadedTabsRef.current.details || loadedTabsRef.current.files) {
            scheduleRefresh("attachments");
          }
          if (loadedTabsRef.current.activity) {
            scheduleRefresh("activity");
          }
        }
      },
      onStatus: (status) => {
        resourceConnectedRef.current = status === "SUBSCRIBED";
      },
    });

    return () => {
      unsubscribe();
      for (const timer of Object.values(refreshTimersRef.current)) {
        if (timer) clearTimeout(timer);
      }
      resourceConnectedRef.current = false;
    };
  }, [loadActivity, loadAttachments, scheduleRefresh, task.id]);

  useEffect(() => {
    const cleanup = createVisibilityAwareInterval(() => {
      if (isConnected && resourceConnectedRef.current) {
        return;
      }

      void loadCounts();
      if (loadedTabsRef.current.details || loadedTabsRef.current.subtasks) {
        void loadSubtasks();
      }
      if (loadedTabsRef.current.details || loadedTabsRef.current.files) {
        void loadAttachments();
      }
      if (loadedTabsRef.current.activity) {
        void loadActivity();
      }
    }, 30_000);

    return () => {
      cleanup();
    };
  }, [isConnected, loadActivity, loadAttachments, loadCounts, loadSubtasks]);

  useEffect(() => {
    setLoading((current) => ({ ...current, comments: discussion.isLoading }));
    setErrors((current) => ({ ...current, comments: discussion.error }));
    if (!discussion.isLoaded) return;
    setCounts((current) => (
      current.comments === discussion.totalCount
        ? current
        : { ...current, comments: discussion.totalCount }
    ));
  }, [discussion.error, discussion.isLoaded, discussion.isLoading, discussion.totalCount]);

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
    attachExisting,
    unlinkAttachment,
    resolvePendingResolution,
    saveAsNewVersion,
    clearPendingFileWarnings,
    downloadAttachment,
  } =
    useTaskFileMutations({
      projectId,
      taskId: task.id,
      canEdit,
      attachments,
      setAttachments,
      refreshAttachments: loadAttachments,
      onError: (message) => setErrors((current) => ({ ...current, attachments: message })),
      onAfterMutation: async () => {
        if (loadedTabsRef.current.activity) {
          await loadActivity();
        }
      },
    });

  useEffect(() => {
    const derivedWarnings = getTaskFileWarnings({
      status: task.status,
      attachments: attachments as TaskLinkedNode[],
      unresolvedReplacement: unresolvedReplacementCount > 0,
      unclassifiedUpload: unclassifiedUploadCount > 0,
    });

    const warnings = mergeFileWarnings(taskMutations.statusWarnings, derivedWarnings);
    setFileWarningState({
      warnings,
      summary: summarizeTaskFileWarnings(warnings),
    });
  }, [
    attachments,
    task.status,
    taskMutations.statusWarnings,
    unclassifiedUploadCount,
    unresolvedReplacementCount,
  ]);

  const addSubtask = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      const error = "Subtask title is required";
      setErrors((current) => ({ ...current, subtasks: error }));
      return { success: false as const, error };
    }

    clearError("subtasks");
    const result = await createSubtaskAction(task.id, trimmed, projectId);
    if (!result.success) {
      const error = result.error || "Failed to add subtask";
      setErrors((current) => ({ ...current, subtasks: error }));
      return { success: false as const, error };
    }

    const rawSubtask = result.data as Record<string, any>;
    const nextSubtask: TaskPanelSubtask = {
      id: String(rawSubtask.id ?? ""),
      taskId: String(rawSubtask.taskId ?? rawSubtask.task_id ?? task.id),
      title: typeof rawSubtask.title === "string" ? rawSubtask.title : trimmed,
      completed: Boolean(rawSubtask.completed),
      position: typeof rawSubtask.position === "number" ? rawSubtask.position : subtasks.length,
      createdAt:
        rawSubtask.createdAt instanceof Date
          ? rawSubtask.createdAt.toISOString()
          : typeof rawSubtask.created_at === "string"
            ? rawSubtask.created_at
            : typeof rawSubtask.createdAt === "string"
              ? rawSubtask.createdAt
              : new Date().toISOString(),
      updatedAt:
        rawSubtask.updatedAt instanceof Date
          ? rawSubtask.updatedAt.toISOString()
          : typeof rawSubtask.updated_at === "string"
            ? rawSubtask.updated_at
            : typeof rawSubtask.updatedAt === "string"
              ? rawSubtask.updatedAt
              : new Date().toISOString(),
    };
    setSubtasks((current) => sortSubtasks([...current, nextSubtask]));
    setCounts((current) => ({ ...current, subtasks: current.subtasks + 1 }));
    if (loadedTabsRef.current.activity) {
      void loadActivity();
    }

    return { success: true as const };
  }, [clearError, loadActivity, projectId, task.id]);

  const toggleSubtask = useCallback(async (subtaskId: string, completed: boolean) => {
    clearError("subtasks");
    const previous = subtasks;
    setSubtasks((current) =>
      current.map((subtask) =>
        subtask.id === subtaskId
          ? { ...subtask, completed: !completed, updatedAt: new Date().toISOString() }
          : subtask,
      ),
    );

    const result = await toggleSubtaskAction(subtaskId, !completed, projectId);
    if (!result.success) {
      setSubtasks(previous);
      const error = result.error || "Failed to update subtask";
      setErrors((current) => ({ ...current, subtasks: error }));
      return { success: false as const, error };
    }

    if (loadedTabsRef.current.activity) {
      void loadActivity();
    }
    return { success: true as const };
  }, [clearError, loadActivity, projectId, subtasks]);

  const removeSubtask = useCallback(async (subtaskId: string) => {
    clearError("subtasks");
    const previous = subtasks;
    setSubtasks((current) => current.filter((subtask) => subtask.id !== subtaskId));
    setCounts((current) => ({ ...current, subtasks: Math.max(0, current.subtasks - 1) }));

    const result = await deleteSubtaskAction(subtaskId, projectId);
    if (!result.success) {
      setSubtasks(previous);
      setCounts((current) => ({ ...current, subtasks: previous.length }));
      const error = result.error || "Failed to delete subtask";
      setErrors((current) => ({ ...current, subtasks: error }));
      return { success: false as const, error };
    }

    if (loadedTabsRef.current.activity) {
      void loadActivity();
    }
    return { success: true as const };
  }, [clearError, loadActivity, projectId, subtasks]);

  return {
    task,
    counts,
    comments: discussion.comments as TaskDiscussionComment[],
    subtasks,
    attachments,
    activity,
    fileWarnings: fileWarningState.warnings,
    fileWarningSummary: fileWarningState.summary,
    loading,
    errors,
    loadedTabs,
    isRealtimeConnected: isConnected && resourceConnectedRef.current,
    discussionPresenceConnected: discussion.isPresenceConnected,
    commentNextCursor: discussion.nextCursor,
    commentLoadingMore: discussion.isLoadingMore,
    commentTyping: {
      topLevel: discussion.topLevelTypingUsers,
      repliesByParentId: discussion.replyTypingUsersByParentId,
    },
    ensureTabLoaded,
    clearError,
    taskMutations,
    addComment: discussion.addComment,
    toggleCommentLike: discussion.toggleLike,
    deleteComment: discussion.deleteComment,
    addSubtask,
    toggleSubtask,
    removeSubtask,
    loadComments: discussion.loadDiscussion,
    loadOlderComments: discussion.loadOlderComments,
    sendCommentTyping: discussion.sendTyping,
    loadSubtasks,
    loadAttachments,
    loadActivity,
    fileMutations: {
      uploadQueue: uploadQueue as TaskFileUploadStatus[],
      isUploading,
      uploadFiles,
      uploadFolders,
      attachExisting,
      unlinkAttachment,
      pendingResolution,
      resolvePendingResolution,
      saveAsNewVersion,
      clearPendingFileWarnings,
      downloadAttachment,
    },
  };
}
