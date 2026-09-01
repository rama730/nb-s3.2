"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface LinkedTask {
  taskId: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  annotation: string | null;
  linkedAt: string;
}

export interface UseTaskLinksReturn {
  tasks: LinkedTask[];
  count: number;
  isLoading: boolean;
  error: string | null;
  link: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  unlink: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  updateAnnotation: (taskId: string, annotation: string) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useTaskLinks(projectId: string, nodeId: string): UseTaskLinksReturn {
  const client = useQueryClient();
  const result = useQuery({
    queryKey: ["files-linked-tasks", projectId, nodeId],
    enabled: Boolean(projectId && nodeId),
    queryFn: async () => {
      const { getTaskLinksForNode } = await import("@/app/actions/files/links");
      return getTaskLinksForNode(projectId, nodeId);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const tasks = result.data ?? EMPTY_TASKS;
  const isLoading = result.isPending;
  const error = result.error?.message ?? null;
  const fetchLinks = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ["files-linked-tasks", projectId, nodeId] });
  }, [client, projectId, nodeId]);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) void fetchLinks();
    };
    window.addEventListener("project:task-files-changed", changed);
    return () => window.removeEventListener("project:task-files-changed", changed);
  }, [fetchLinks, projectId]);

  const notifyChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId, nodeId } }));
  }, [projectId, nodeId]);

  const refresh = useCallback(async () => {
    await fetchLinks();
  }, [fetchLinks]);

  const link = useCallback(
    async (taskId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { linkNodeToTask } = await import("@/app/actions/files/links");
        await linkNodeToTask(taskId, nodeId, { role: "reference" });
        notifyChanged();
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to link task";
        return { success: false, error: message };
      }
    },
    [nodeId, notifyChanged],
  );

  const unlink = useCallback(
    async (taskId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { unlinkNodeFromTask } = await import("@/app/actions/files/links");
        await unlinkNodeFromTask(taskId, nodeId);
        notifyChanged();
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to unlink task";
        return { success: false, error: message };
      }
    },
    [nodeId, notifyChanged],
  );

  const updateAnnotation = useCallback(
    async (taskId: string, annotation: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { updateTaskNodeLink } = await import("@/app/actions/files/links");
        await updateTaskNodeLink(taskId, nodeId, { annotation });
        notifyChanged();
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update annotation";
        return { success: false, error: message };
      }
    },
    [nodeId, notifyChanged],
  );

  return useMemo(() => ({
    tasks,
    count: tasks.length,
    isLoading,
    error,
    link,
    unlink,
    updateAnnotation,
    refresh,
  }), [tasks, isLoading, error, link, unlink, updateAnnotation, refresh]);
}

const EMPTY_TASKS: LinkedTask[] = [];
