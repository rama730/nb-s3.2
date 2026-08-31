"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";

export function useRealtimeTasks(projectId: string, deferredTaskId: string | null = null) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredTaskRef = useRef<string | null>(deferredTaskId);
  const deferredTaskChangedRef = useRef(false);

  useEffect(() => {
    const previouslyDeferred = deferredTaskRef.current;
    deferredTaskRef.current = deferredTaskId;
    if (previouslyDeferred && !deferredTaskId && deferredTaskChangedRef.current) {
      deferredTaskChangedRef.current = false;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.tasksRoot(projectId),
        refetchType: "active",
      });
    }
  }, [deferredTaskId, projectId, queryClient]);

  useEffect(() => {
    if (!projectId) return;

    const scheduleReconcile = () => {
      if (reconcileTimerRef.current) return;
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.tasksRoot(projectId),
          refetchType: "active",
        });
      }, 150);
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
            const eventRow = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<string, unknown> | null;
            const eventTaskId = typeof eventRow?.id === "string" ? eventRow.id : null;
            if (eventTaskId && eventTaskId === deferredTaskRef.current) {
              // ponytail: reconcile this one task after its optimistic drag settles instead of fighting the pointer mid-drag.
              deferredTaskChangedRef.current = true;
              return;
            }

            // ponytail: Dumb invalidation. If 30 changes happen, this absorbs it into 1 fetch. Zero stutter.
            scheduleReconcile();
          },
        },
      ],
    });

    return () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [projectId, queryClient, supabase]);
}
