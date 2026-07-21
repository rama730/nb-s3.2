"use client";

import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { readPeoplePendingCountsAction } from "@/app/actions/connections";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { queryKeys } from "@/lib/query-keys";

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
