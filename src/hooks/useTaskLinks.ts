"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchLinks = useCallback(async () => {
    if (!projectId || !nodeId) return;
    try {
      const { getTaskLinksForNode } = await import("@/app/actions/files/links");
      const result = await getTaskLinksForNode(projectId, nodeId);
      if (mountedRef.current) {
        setTasks(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch task links");
      }
    }
  }, [projectId, nodeId]);

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);
    setError(null);

    fetchLinks().finally(() => {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
    };
  }, [fetchLinks]);

  const refresh = useCallback(async () => {
    await fetchLinks();
  }, [fetchLinks]);

  const link = useCallback(
    async (taskId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { linkNodeToTask } = await import("@/app/actions/files/links");
        await linkNodeToTask(taskId, nodeId, { role: "reference" });
        await fetchLinks();
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to link task";
        return { success: false, error: message };
      }
    },
    [nodeId, fetchLinks],
  );

  const unlink = useCallback(
    async (taskId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { unlinkNodeFromTask } = await import("@/app/actions/files/links");
        await unlinkNodeFromTask(taskId, nodeId);
        await fetchLinks();
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to unlink task";
        return { success: false, error: message };
      }
    },
    [nodeId, fetchLinks],
  );

  const updateAnnotation = useCallback(
    async (taskId: string, annotation: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { updateTaskNodeLink } = await import("@/app/actions/files/links");
        await updateTaskNodeLink(taskId, nodeId, { annotation });
        await fetchLinks();
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update annotation";
        return { success: false, error: message };
      }
    },
    [nodeId, fetchLinks],
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
