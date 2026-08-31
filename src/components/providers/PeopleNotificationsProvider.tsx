"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readPeoplePendingCountsAction } from "@/app/actions/connections";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { queryKeys } from "@/lib/query-keys";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import type { UserNotificationEvent } from "@/lib/realtime/subscriptions";

const WORKSPACE_NOTIFICATION_KINDS = new Set([
  "connection_request_received",
  "connection_request_accepted",
  "task_assigned",
  "task_status_attention",
  "task_comment_mention",
  "task_comment_reply",
  "task_file_version",
  "task_file_replaced",
  "task_file_needs_review",
  "file_version_added",
  "workflow_assigned",
  "workflow_resolved",
  "application_received",
  "application_decision",
]);

type WorkspaceInvalidationDomain = "connections" | "requests" | "tasks";

function workspaceInvalidationDomains(kind: string): WorkspaceInvalidationDomain[] {
  if (kind.startsWith("connection_request_")) return ["connections", "requests"];
  if (kind.startsWith("task_")) return ["tasks"];
  if (kind.startsWith("workflow_") || kind.startsWith("application_")) return ["requests"];
  return [];
}

function workspaceNotificationKind(event: UserNotificationEvent) {
  if (event.kind !== "notification") return null;
  const payload = event.payload.new as Record<string, unknown> | undefined;
  const kind = typeof payload?.kind === "string" ? payload.kind : null;
  return kind && WORKSPACE_NOTIFICATION_KINDS.has(kind) ? kind : null;
}

interface PeopleNotificationsContextValue {
  totalPending: number;
  pendingConnections: number;
  pendingInvites: number;
  refresh: () => Promise<void>;
}

const PeopleNotificationsContext = createContext<PeopleNotificationsContextValue>({
  totalPending: 0,
  pendingConnections: 0,
  pendingInvites: 0,
  refresh: async () => {},
});

export function PeopleNotificationsProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const { user } = useAuthContext();
  const { subscribeUserNotifications } = useRealtime();
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvalidationDomainsRef = useRef(new Set<WorkspaceInvalidationDomain>());

  const query = useQuery({
    queryKey: queryKeys.connections.pending(),
    enabled: Boolean(enabled && user?.id),
    queryFn: async () => {
      const result = await readPeoplePendingCountsAction();
      if (!result.success) throw new Error(result.error || "Failed to load pending requests");
      return result;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
  const pendingConnections = query.data?.pendingConnections ?? 0;
  const pendingInvites = query.data?.pendingInvites ?? 0;

  // One app-level listener owns workspace attention invalidation. This avoids
  // opening the drawer creating a second subscription or duplicate refetches.
  useEffect(() => {
    if (!enabled || !user?.id) return;
    const unsubscribe = subscribeUserNotifications((event) => {
      const kind = workspaceNotificationKind(event);
      if (!kind) return;
      for (const domain of workspaceInvalidationDomains(kind)) {
        pendingInvalidationDomainsRef.current.add(domain);
      }
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        const domains = pendingInvalidationDomainsRef.current;
        pendingInvalidationDomainsRef.current = new Set();
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root(), refetchType: "active" });
        if (domains.has("connections")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.connections.pending(), refetchType: "active" });
          void queryClient.invalidateQueries({ queryKey: ["connections", "pending-requests"], refetchType: "active" });
        }
        if (domains.has("requests")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.joinRequests(), refetchType: "active" });
          void queryClient.invalidateQueries({ queryKey: ["people", "project-applications"], refetchType: "active" });
        }
      }, 150);
    });
    return () => {
      unsubscribe();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      pendingInvalidationDomainsRef.current.clear();
    };
  }, [enabled, queryClient, subscribeUserNotifications, user?.id]);

  const value = useMemo<PeopleNotificationsContextValue>(
    () => ({
      totalPending: pendingConnections + pendingInvites,
      pendingConnections,
      pendingInvites,
      refresh,
    }),
    [pendingConnections, pendingInvites, refresh],
  );

  return <PeopleNotificationsContext.Provider value={value}>{children}</PeopleNotificationsContext.Provider>;
}

export function usePeopleNotificationsContext() {
  return useContext(PeopleNotificationsContext);
}
