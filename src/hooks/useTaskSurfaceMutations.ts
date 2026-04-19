"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { assignTaskAction, updateTaskFieldAction, updateTaskStatusAction, type TaskStatus } from "@/app/actions/task";
import { queryKeys } from "@/lib/query-keys";
import { patchProjectTaskCaches } from "@/lib/projects/task-cache";
import type { TaskFileReadinessWarning } from "@/lib/projects/task-file-intelligence";
import { patchSprintDetailInfiniteData, type SprintTaskMutationRecord } from "@/lib/projects/sprint-cache";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import {
  normalizeSprintOptions,
  normalizeTaskSurfacePerson,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import type { ProjectNode } from "@/lib/db/schema";

type MutableTaskField = "title" | "description" | "priority" | "sprintId" | "dueDate";

function toLinkedSprintFiles(nodes: ProjectNode[], taskId: string, occurredAt: string | null) {
  return nodes.map((node, index) => ({
    id: `linked-file:${taskId}:${node.id}:${index}`,
    taskId,
    nodeId: node.id,
    nodeName: node.name,
    nodePath: node.path ?? node.name,
    nodeType: node.type === "folder" ? ("folder" as const) : ("file" as const),
    annotation: null,
    linkedAt: occurredAt ?? null,
    lastEventType: null,
    lastEventAt: node.updatedAt instanceof Date ? node.updatedAt.toISOString() : null,
    lastEventBy: null,
  }));
}

function toSprintMutationRecord(
  task: TaskSurfaceRecord,
  projectId: string,
  attachments: ProjectNode[],
): SprintTaskMutationRecord {
  return {
    id: task.id,
    projectId,
    projectKey: task.projectKey,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    storyPoints: task.storyPoints,
    sprintId: task.sprintId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    taskNumber: task.taskNumber,
    assignee: task.assignee,
    creator: task.creator,
    linkedFileCount: attachments.length,
    linkedFiles: toLinkedSprintFiles(attachments, task.id, task.updatedAt ?? task.createdAt),
  };
}

type SnapshotBundle = {
  taskSlices: Array<[readonly unknown[], unknown]>;
  sprintSlices: Array<[readonly unknown[], unknown]>;
};

function isTaskStatus(value: string): value is TaskStatus {
  return value === "todo" || value === "in_progress" || value === "blocked" || value === "done";
}

export function useTaskSurfaceMutations(params: {
  task: TaskSurfaceRecord;
  projectId: string;
  attachments: ProjectNode[];
  sprints?: any[];
  members?: any[];
  onTaskChange: (task: TaskSurfaceRecord) => void;
}) {
  const { task, projectId, attachments, sprints = [], members = [], onTaskChange } = params;
  const queryClient = useQueryClient();
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [statusWarnings, setStatusWarnings] = useState<TaskFileReadinessWarning[]>([]);

  const availableSprints = useMemo(() => normalizeSprintOptions(sprints), [sprints]);
  const availableMembers = useMemo(
    () =>
      members
        .map((member) => {
          const identity = normalizeTaskSurfacePerson(member?.user ?? member);
          const id = member?.user_id || member?.id || identity?.id;
          if (!id) return null;
          return { id: String(id), identity };
        })
        .filter(Boolean) as { id: string; identity: ReturnType<typeof normalizeTaskSurfacePerson> }[],
    [members],
  );

  const takeSnapshots = useCallback((): SnapshotBundle => {
    return {
      taskSlices: queryClient.getQueriesData({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }),
      sprintSlices: queryClient.getQueriesData({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) }),
    };
  }, [projectId, queryClient]);

  const restoreSnapshots = useCallback((snapshots: SnapshotBundle) => {
    for (const [queryKey, snapshot] of snapshots.taskSlices) {
      queryClient.setQueryData(queryKey, snapshot);
    }
    for (const [queryKey, snapshot] of snapshots.sprintSlices) {
      queryClient.setQueryData(queryKey, snapshot);
    }
  }, [queryClient]);

  const patchSprintCaches = useCallback((beforeTask: TaskSurfaceRecord, afterTask: TaskSurfaceRecord) => {
    const beforeRecord = toSprintMutationRecord(beforeTask, projectId, attachments);
    const afterRecord = toSprintMutationRecord(afterTask, projectId, attachments);
    queryClient.setQueriesData(
      { queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) },
      (existing: unknown) => patchSprintDetailInfiniteData(existing, beforeRecord, afterRecord),
    );
  }, [attachments, projectId, queryClient]);

  const applyOptimisticTask = useCallback((nextTask: TaskSurfaceRecord, field: string) => {
    patchProjectTaskCaches(queryClient, projectId, nextTask);
    patchSprintCaches(task, nextTask);
    onTaskChange(nextTask);
    recordSprintMetric("project.sprint.optimistic_patch", {
      projectId,
      taskId: task.id,
      field,
      result: "applied",
    });
  }, [onTaskChange, patchSprintCaches, projectId, queryClient, task]);

  const rollbackOptimisticTask = useCallback((snapshots: SnapshotBundle, previousTask: TaskSurfaceRecord, field: string) => {
    restoreSnapshots(snapshots);
    onTaskChange(previousTask);
    recordSprintMetric("project.sprint.optimistic_patch", {
      projectId,
      taskId: task.id,
      field,
      result: "rolled_back",
    });
  }, [onTaskChange, projectId, restoreSnapshots, task.id]);

  const buildFieldTask = useCallback((field: MutableTaskField, value: unknown) => {
    const nextTask = normalizeTaskSurfaceRecord(task);

    if (field === "title") {
      nextTask.title = typeof value === "string" ? value.trim() : "";
    } else if (field === "description") {
      nextTask.description = typeof value === "string" && value.trim() ? value : null;
    } else if (field === "priority") {
      nextTask.priority = String(value || "medium") as TaskSurfaceRecord["priority"];
    } else if (field === "sprintId") {
      const sprintId = typeof value === "string" && value ? value : null;
      const sprint = availableSprints.find((entry) => entry.id === sprintId) ?? null;
      nextTask.sprintId = sprintId;
      nextTask.sprint = sprint ? { id: sprint.id, name: sprint.name, status: sprint.status } : null;
    } else if (field === "dueDate") {
      nextTask.dueDate = typeof value === "string" && value ? value : null;
    }

    nextTask.updatedAt = new Date().toISOString();
    return nextTask;
  }, [availableSprints, task]);

  const updateField = useCallback(async (field: MutableTaskField, value: unknown) => {
    setMutationError(null);
    if (field !== "title") {
      setStatusWarnings([]);
    }
    setIsMutating(true);
    const previousTask = normalizeTaskSurfaceRecord(task);
    const nextTask = buildFieldTask(field, value);
    const snapshots = takeSnapshots();

    applyOptimisticTask(nextTask, field);

    try {
      const result = await updateTaskFieldAction(task.id, field, value, projectId);
      if (!result.success) {
        throw new Error(result.error || "Failed to update task");
      }
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update task";
      rollbackOptimisticTask(snapshots, previousTask, field);
      setMutationError(message);
      return { success: false as const, error: message };
    } finally {
      setIsMutating(false);
    }
  }, [applyOptimisticTask, buildFieldTask, projectId, rollbackOptimisticTask, takeSnapshots, task]);

  const updateStatus = useCallback(async (status: string) => {
    if (!isTaskStatus(status)) {
      const error = "Invalid task status";
      setMutationError(error);
      return { success: false as const, error };
    }

    setMutationError(null);
    setStatusWarnings([]);
    setIsMutating(true);

    const previousTask = normalizeTaskSurfaceRecord(task);
    const nextTask = normalizeTaskSurfaceRecord({
      ...task,
      status,
      updatedAt: new Date().toISOString(),
    });
    const snapshots = takeSnapshots();

    applyOptimisticTask(nextTask, "status");

    try {
      const result = await updateTaskStatusAction(task.id, status, projectId);
      if (!result.success) {
        throw new Error(result.error || "Failed to update task status");
      }
      setStatusWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update task status";
      rollbackOptimisticTask(snapshots, previousTask, "status");
      setMutationError(message);
      return { success: false as const, error: message };
    } finally {
      setIsMutating(false);
    }
  }, [applyOptimisticTask, projectId, rollbackOptimisticTask, takeSnapshots, task]);

  const updateAssignee = useCallback(async (assigneeId: string | null) => {
    setMutationError(null);
    setStatusWarnings([]);
    setIsMutating(true);

    const previousTask = normalizeTaskSurfaceRecord(task);
    const nextMember = availableMembers.find((member) => member.id === assigneeId) ?? null;
    const nextTask = normalizeTaskSurfaceRecord({
      ...task,
      assigneeId: assigneeId || null,
      assignee: assigneeId
        ? {
            id: assigneeId,
            fullName: nextMember?.identity?.fullName ?? "Assigned user",
            avatarUrl: nextMember?.identity?.avatarUrl ?? null,
          }
        : null,
      updatedAt: new Date().toISOString(),
    });
    const snapshots = takeSnapshots();

    applyOptimisticTask(nextTask, "assigneeId");

    try {
      const result = await assignTaskAction(task.id, assigneeId, projectId);
      if (!result.success) {
        throw new Error(result.error || "Failed to assign task");
      }
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to assign task";
      rollbackOptimisticTask(snapshots, previousTask, "assigneeId");
      setMutationError(message);
      return { success: false as const, error: message };
    } finally {
      setIsMutating(false);
    }
  }, [applyOptimisticTask, availableMembers, projectId, rollbackOptimisticTask, takeSnapshots, task]);

  return {
    isMutating,
    mutationError,
    statusWarnings,
    clearMutationError: () => setMutationError(null),
    clearStatusWarnings: () => setStatusWarnings([]),
    updateField,
    updateStatus,
    updateAssignee,
  };
}
