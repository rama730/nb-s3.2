import { useEffect, useRef } from 'react';
import {
    InfiniteData,
    QueryKey,
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import {
    acceptAllIncomingConnectionRequests,
    acceptConnectionRequest,
    cancelConnectionRequest,
    dismissConnectionSuggestion,
    getConnectionStats,
    getConnectionsFeed,
    rejectAllIncomingConnectionRequests,
    rejectConnectionRequest,
    removeConnection,
    sendConnectionRequest,
    undoRejectConnectionRequest,
    type ConnectionsFeedInput,
    type ConnectionsFeedTab,
} from '@/app/actions/connections';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type FeedStats = {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
};

type FeedPage<T = any> = {
    success: true;
    items: T[];
    hasMore: boolean;
    nextCursor: string | null;
    stats: FeedStats;
};

type FeedErrorPage = {
    success: false;
    error?: string;
    items: [];
    hasMore: false;
    nextCursor: null;
    stats: FeedStats;
};

const EMPTY_STATS: FeedStats = {
    totalConnections: 0,
    pendingIncoming: 0,
    pendingSent: 0,
};

export const CONNECTIONS_QUERY_KEYS = {
    root: ['connections'] as const,
    feed: (tab: ConnectionsFeedTab, limit: number, search?: string) =>
        ['connections', 'feed', tab, limit, search || ''] as const,
    pendingRequests: (limit: number) => ['connections', 'pending-requests', limit] as const,
    suggestions: (limit: number, search?: string) => ['connections', 'suggestions', limit, search || ''] as const,
    stats: (userId: string) => ['connections', 'stats', userId] as const,
};

function normalizeFeedResult(result: FeedPage | FeedErrorPage): FeedPage {
    if (!result.success) {
        throw new Error(result.error || 'Failed to load connections');
    }
    return result;
}

function updateFeedQueries<T>(
    queryClient: ReturnType<typeof useQueryClient>,
    keyPrefix: QueryKey,
    updater: (page: FeedPage<T>) => FeedPage<T>,
) {
    const all = queryClient.getQueriesData<InfiniteData<FeedPage<T>>>({ queryKey: keyPrefix });
    for (const [key, data] of all) {
        if (!data) continue;
        const next: InfiniteData<FeedPage<T>> = {
            ...data,
            pages: data.pages.map((page) => updater(page)),
        };
        queryClient.setQueryData(key, next);
    }
}

function updateStatsQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (stats: FeedStats) => FeedStats,
) {
    const keys = queryClient
        .getQueriesData<{ totalConnections: number; pendingIncoming: number; pendingSent: number }>({
            queryKey: ['connections', 'stats'],
        });
    for (const [key, value] of keys) {
        if (!value) continue;
        queryClient.setQueryData(key, updater({
            totalConnections: Number(value.totalConnections || 0),
            pendingIncoming: Number(value.pendingIncoming || 0),
            pendingSent: Number(value.pendingSent || 0),
        }));
    }
}

export function useConnectionsRealtimeInvalidation() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const userId = user?.id;
    const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!userId) return;
        const scheduleInvalidate = () => {
            if (invalidateTimerRef.current) return;
            invalidateTimerRef.current = setTimeout(() => {
                invalidateTimerRef.current = null;
                queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEYS.root });
            }, 250);
        };

        const supabase = createSupabaseBrowserClient();
        const channel = supabase
            .channel(`connections-feed-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'connections',
                    filter: `requester_id=eq.${userId}`,
                },
                scheduleInvalidate,
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'connections',
                    filter: `addressee_id=eq.${userId}`,
                },
                scheduleInvalidate,
            )
            .subscribe();

        return () => {
            if (invalidateTimerRef.current) {
                clearTimeout(invalidateTimerRef.current);
                invalidateTimerRef.current = null;
            }
            void supabase.removeChannel(channel);
        };
    }, [queryClient, userId]);
}

export function useConnectionsFeed(
    tab: ConnectionsFeedTab,
    options?: {
        limit?: number;
        search?: string;
        enabled?: boolean;
    },
) {
    const limit = options?.limit ?? 20;
    const search = options?.search;
    const enabled = options?.enabled ?? true;

    return useInfiniteQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.feed(tab, limit, search),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await getConnectionsFeed({
                tab,
                limit,
                search,
                cursor: pageParam,
            } satisfies ConnectionsFeedInput);
            return normalizeFeedResult(result as FeedPage | FeedErrorPage);
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        enabled,
    });
}

export function useConnections(limit = 50, search?: string) {
    return useConnectionsFeed('network', { limit, search });
}

export function useSuggestedPeople(limit = 20, search?: string) {
    return useConnectionsFeed('discover', { limit, search });
}

export function usePendingRequests(limit = 20) {
    return useQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.pendingRequests(limit),
        queryFn: async () => {
            const [incoming, sent] = await Promise.all([
                getConnectionsFeed({ tab: 'requests_incoming', limit }),
                getConnectionsFeed({ tab: 'requests_sent', limit }),
            ]);

            const incomingOk = incoming.success ? incoming : { items: [], hasMore: false, nextCursor: null, stats: EMPTY_STATS };
            const sentOk = sent.success ? sent : { items: [], hasMore: false, nextCursor: null, stats: EMPTY_STATS };
            return {
                incoming: incomingOk.items.map((item: any) => ({
                    id: item.id,
                    requesterId: item.requesterId,
                    addresseeId: item.addresseeId,
                    status: item.status,
                    createdAt: item.createdAt,
                    requesterUsername: item.user?.username,
                    requesterFullName: item.user?.fullName,
                    requesterAvatarUrl: item.user?.avatarUrl,
                    requesterHeadline: item.user?.headline,
                })),
                sent: sentOk.items.map((item: any) => ({
                    id: item.id,
                    requesterId: item.requesterId,
                    addresseeId: item.addresseeId,
                    status: item.status,
                    createdAt: item.createdAt,
                    addresseeUsername: item.user?.username,
                    addresseeFullName: item.user?.fullName,
                    addresseeAvatarUrl: item.user?.avatarUrl,
                    addresseeHeadline: item.user?.headline,
                })),
                hasMoreIncoming: incomingOk.hasMore,
                hasMoreSent: sentOk.hasMore,
                stats: incomingOk.stats || sentOk.stats || EMPTY_STATS,
            };
        },
        staleTime: 30_000,
        refetchInterval: 30_000,
    });
}

export function useConnectionStats(userId?: string) {
    const scope = userId || 'me';
    return useQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.stats(scope),
        queryFn: () => getConnectionStats(userId),
        staleTime: 60_000,
        refetchInterval: userId ? false : 60_000,
    });
}

export function useConnectionMutations() {
    const queryClient = useQueryClient();

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEYS.root });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
    };

    const sendRequest = useMutation({
        mutationFn: async ({ userId, message }: { userId: string; message?: string }) => {
            const result = await sendConnectionRequest(userId, message);
            if (!result.success) throw new Error(result.error || 'Failed to send request');
            return { ...result, userId };
        },
        onMutate: async ({ userId }) => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });

            updateFeedQueries(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item: any) =>
                    item.id === userId
                        ? { ...item, connectionStatus: 'pending_sent', canConnect: false }
                        : item,
                ),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: stats.pendingSent + 1,
            }));
        },
        onError: () => {
            invalidateAll();
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const cancelRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await cancelConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to cancel request');
            return { id };
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            queryClient.setQueriesData({ queryKey: ['connections', 'pending-requests'] }, (prev: any) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    sent: prev.sent.filter((item: any) => item.id !== id),
                };
            });
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: Math.max(0, stats.pendingSent - 1),
            }));
        },
        onError: () => {
            invalidateAll();
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to accept request');
            return { id };
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            queryClient.setQueriesData({ queryKey: ['connections', 'pending-requests'] }, (prev: any) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    incoming: prev.incoming.filter((item: any) => item.id !== id),
                };
            });
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: stats.totalConnections + 1,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: () => {
            invalidateAll();
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const rejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await rejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to reject request');
            return { id, undoUntil: result.undoUntil };
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            queryClient.setQueriesData({ queryKey: ['connections', 'pending-requests'] }, (prev: any) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    incoming: prev.incoming.filter((item: any) => item.id !== id),
                };
            });
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: () => {
            invalidateAll();
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const dismissSuggestion = useMutation({
        mutationFn: async (profileId: string) => {
            const result = await dismissConnectionSuggestion(profileId);
            if (!result.success) throw new Error(result.error || 'Failed to dismiss suggestion');
            return { profileId };
        },
        onMutate: async (profileId) => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            updateFeedQueries(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.filter((item: any) => item.id !== profileId),
            }));
        },
        onError: () => {
            invalidateAll();
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const undoRejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await undoRejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to undo reject');
            return { id };
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const acceptAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await acceptAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to accept all requests');
            return result;
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            let acceptedCount = 0;
            queryClient.setQueriesData({ queryKey: ['connections', 'pending-requests'] }, (prev: any) => {
                if (!prev) return prev;
                acceptedCount = Math.max(acceptedCount, Array.isArray(prev.incoming) ? prev.incoming.length : 0);
                return {
                    ...prev,
                    incoming: [],
                };
            });
            if (acceptedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    totalConnections: stats.totalConnections + acceptedCount,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - acceptedCount),
                }));
            }
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const rejectAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await rejectAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to reject all requests');
            return result;
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            let rejectedCount = 0;
            queryClient.setQueriesData({ queryKey: ['connections', 'pending-requests'] }, (prev: any) => {
                if (!prev) return prev;
                rejectedCount = Math.max(rejectedCount, Array.isArray(prev.incoming) ? prev.incoming.length : 0);
                return {
                    ...prev,
                    incoming: [],
                };
            });
            if (rejectedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - rejectedCount),
                }));
            }
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    const disconnect = useMutation({
        mutationFn: async (id: string) => {
            const result = await removeConnection(id);
            if (!result.success) throw new Error(result.error || 'Failed to remove connection');
            return { id };
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['connections'] });
            updateFeedQueries(queryClient, ['connections', 'feed', 'network'], (page) => ({
                ...page,
                items: page.items.filter((item: any) => item.id !== id),
            }));
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: Math.max(0, stats.totalConnections - 1),
            }));
        },
        onError: () => {
            invalidateAll();
        },
        onSettled: () => {
            invalidateAll();
        },
    });

    return {
        sendRequest,
        cancelRequest,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        disconnect,
    };
}
