import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import {
  compareTaskSurfaceRecords,
  mergeTaskSurfaceRecords,
  normalizeTaskSurfaceRecord,
  taskSurfaceVersionMs,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";

type TaskInfinitePage = {
  success?: boolean;
  tasks: TaskSurfaceRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

type TaskInfiniteData = {
  pages: TaskInfinitePage[];
  pageParams: unknown[];
};

type TaskScope = "all" | "backlog" | "sprint";

function isInfiniteTaskData(value: unknown): value is TaskInfiniteData {
  return !!value && typeof value === "object" && Array.isArray((value as TaskInfiniteData).pages);
}

function matchesScope(task: TaskSurfaceRecord, scope: TaskScope) {
  if (scope === "backlog") return !task.sprintId;
  if (scope === "sprint") return !!task.sprintId;
  return true;
}

function patchTaskList(
  list: TaskSurfaceRecord[],
  incoming: TaskSurfaceRecord,
  scope: TaskScope,
): TaskSurfaceRecord[] {
  const normalizedIncoming = normalizeTaskSurfaceRecord(incoming);
  const next: TaskSurfaceRecord[] = [];
  let seen = false;

  for (const task of list) {
    if (task.id !== normalizedIncoming.id) {
      next.push(normalizeTaskSurfaceRecord(task));
      continue;
    }

    seen = true;
    const current = normalizeTaskSurfaceRecord(task);
    const merged =
      taskSurfaceVersionMs(current) > taskSurfaceVersionMs(normalizedIncoming)
        ? current
        : mergeTaskSurfaceRecords(current, normalizedIncoming);

    if (matchesScope(merged, scope)) {
      next.push(merged);
    }
  }

  if (!seen && matchesScope(normalizedIncoming, scope)) {
    next.push(normalizedIncoming);
  }

  return next.sort(compareTaskSurfaceRecords);
}

function removeTaskFromList(list: TaskSurfaceRecord[], taskId: string) {
  return list.filter((task) => task.id !== taskId).map(normalizeTaskSurfaceRecord);
}

export function patchTaskQueryData(
  existing: unknown,
  incoming: TaskSurfaceRecord,
  scope: TaskScope,
): unknown {
  if (Array.isArray(existing)) {
    return patchTaskList(existing.map(normalizeTaskSurfaceRecord), incoming, scope);
  }

  if (isInfiniteTaskData(existing)) {
    return {
      ...existing,
      pages: existing.pages.map((page) => ({
        ...page,
        tasks: patchTaskList((page.tasks ?? []).map(normalizeTaskSurfaceRecord), incoming, scope),
      })),
    } satisfies TaskInfiniteData;
  }

  return existing;
}

export function removeTaskFromQueryData(existing: unknown, taskId: string): unknown {
  if (Array.isArray(existing)) {
    return removeTaskFromList(existing.map(normalizeTaskSurfaceRecord), taskId);
  }

  if (isInfiniteTaskData(existing)) {
    return {
      ...existing,
      pages: existing.pages.map((page) => ({
        ...page,
        tasks: removeTaskFromList((page.tasks ?? []).map(normalizeTaskSurfaceRecord), taskId),
      })),
    } satisfies TaskInfiniteData;
  }

  return existing;
}

export function patchProjectTaskCaches(
  queryClient: QueryClient,
  projectId: string,
  incoming: TaskSurfaceRecord,
) {
  for (const scope of ["all", "backlog", "sprint"] as const) {
    queryClient.setQueryData(queryKeys.project.detail.tasks(projectId, scope), (existing: unknown) =>
      patchTaskQueryData(existing, incoming, scope),
    );
  }
}

export function removeTaskFromProjectTaskCaches(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
) {
  for (const scope of ["all", "backlog", "sprint"] as const) {
    queryClient.setQueryData(queryKeys.project.detail.tasks(projectId, scope), (existing: unknown) =>
      removeTaskFromQueryData(existing, taskId),
    );
  }
}

export function findTaskInProjectTaskCaches(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
) {
  for (const scope of ["all", "backlog", "sprint"] as const) {
    const data = queryClient.getQueryData(queryKeys.project.detail.tasks(projectId, scope));
    if (Array.isArray(data)) {
      const task = data.map(normalizeTaskSurfaceRecord).find((entry) => entry.id === taskId);
      if (task) return task;
      continue;
    }

    if (isInfiniteTaskData(data)) {
      for (const page of data.pages) {
        const task = (page.tasks ?? []).map(normalizeTaskSurfaceRecord).find((entry) => entry.id === taskId);
        if (task) return task;
      }
    }
  }

  return null;
}
