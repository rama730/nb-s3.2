"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getProjectTaskDetailAction } from "@/app/actions/project";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { createClient } from "@/lib/supabase/client";
import {
  findTaskInProjectTaskCaches,
  patchProjectTaskCaches,
  removeTaskFromProjectTaskCaches,
} from "@/lib/projects/task-cache";
import {
  mergeTaskSurfaceRecords,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";

function shouldHydrateTask(input: {
  incoming: TaskSurfaceRecord;
  cached: TaskSurfaceRecord | null;
}) {
  const { incoming, cached } = input;
  if (!cached) return true;
  if (!incoming.projectKey && !!cached.projectKey) return false;
  if (incoming.assigneeId !== cached.assigneeId && !incoming.assignee) return true;
  if (incoming.creatorId !== cached.creatorId && !incoming.creator) return true;
  if (incoming.sprintId !== cached.sprintId && !incoming.sprint) return true;
  return false;
}

export function useRealtimeTasks(projectId: string) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const hydrateTask = async (taskId: string) => {
      const result = await getProjectTaskDetailAction(projectId, taskId);
      if (!result.success || !result.task) return;
      patchProjectTaskCaches(queryClient, projectId, normalizeTaskSurfaceRecord(result.task));
    };

    const channel = subscribeActiveResource({
      supabase,
      resourceType: "workspace",
      resourceId: `project-tasks:${projectId}`,
      bindings: [
        {
          event: "*",
          table: "tasks",
          filter: `project_id=eq.${projectId}`,
          handler: (payload) => {
            if (payload.eventType === "DELETE") {
              const previousRow = (payload.old ?? null) as Record<string, unknown> | null;
              const deletedId = typeof previousRow?.id === "string" ? previousRow.id : null;
              if (deletedId) {
                removeTaskFromProjectTaskCaches(queryClient, projectId, deletedId);
              }
              return;
            }

            const incoming = normalizeTaskSurfaceRecord(payload.new);
            const cached = findTaskInProjectTaskCaches(queryClient, projectId, incoming.id);
            const merged = mergeTaskSurfaceRecords(cached, incoming);
            patchProjectTaskCaches(queryClient, projectId, merged);

            if (shouldHydrateTask({ incoming, cached })) {
              void hydrateTask(incoming.id);
            }
          },
        },
      ],
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, queryClient, supabase]);
}
