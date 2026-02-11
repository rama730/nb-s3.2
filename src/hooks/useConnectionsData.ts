"use client";

import { CONNECTIONS_QUERY_KEYS, useConnectionStats, usePendingRequests, useSuggestedPeople } from '@/hooks/useConnections';
import type { ConnectionStats } from '@/app/actions/connections';
import type { DiscoverConnectionItem, PendingRequestsData } from '@/hooks/useConnections';

export const CONNECTIONS_KEYS = {
    suggestions: (limit: number) => CONNECTIONS_QUERY_KEYS.suggestions(limit),
    stats: (userId?: string) => CONNECTIONS_QUERY_KEYS.stats(userId || 'me'),
    requests: CONNECTIONS_QUERY_KEYS.pendingRequests(20),
};

export function useSuggestedPeopleData(limit = 20, _initialData?: DiscoverConnectionItem[]) {
    void _initialData;
    return useSuggestedPeople(limit);
}

export function useConnectionStatsData(userId?: string, _initialData?: ConnectionStats | null) {
    void _initialData;
    return useConnectionStats(userId);
}

export function usePendingRequestsData(limit = 20, _initialData?: PendingRequestsData | null) {
    void _initialData;
    return usePendingRequests(limit);
}

// Backward-compatible exports used across existing components
export { useSuggestedPeopleData as useSuggestedPeople };
export { useConnectionStatsData as useConnectionStats };
export { usePendingRequestsData as usePendingRequests };
