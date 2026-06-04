import { useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
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
    bulkDisconnectConnections,
    bulkUpdateConnectionTags,
    cancelConnectionRequest,
    withdrawAllSentConnectionRequests,
    dismissConnectionSuggestion,
    getConnectionTags,
    getConnectionStats,
    getConnectionRequestHistory,
    getConnectionsFeed,
    getMutualSuggestions,
    getRoleSuggestions,
    rejectAllIncomingConnectionRequests,
    rejectConnectionRequest,
    removeConnection,
    sendConnectionRequest,
    undoDismissConnectionSuggestion,
    undoRejectConnectionRequest,
    updateConnectionTags,
    type ConnectionRequestHistoryItem,
    type ConnectionStats,
    type ConnectionsFeedInput,
    type ConnectionsFeedTab,
    type DiscoverFilters,
    type HistoryFilters,
    type SuggestedProfile,
} from '@/app/actions/connections';
import {
    getApplicationRequestHistory,
    type ApplicationRequestHistoryItem,
} from '@/app/actions/applications';
import { queryKeys } from '@/lib/query-keys';

export type FeedStats = Pick<ConnectionStats, 'totalConnections' | 'pendingIncoming' | 'pendingSent'>;

export type NetworkConnectionItem = {
    id: string;
    type: 'network';
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    tags?: string[];
    isActive?: boolean;
    otherUser: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline: string | null;
        location: string | null;
        skills?: string[];
        interests?: string[];
        bio?: string | null;
        openTo?: string[];
        messagePrivacy?: SuggestedProfile['messagePrivacy'];
        canSendMessage?: boolean;
        lastActiveAt?: string | null;
    };
};

export type DiscoverConnectionItem = SuggestedProfile & {
    type: 'discover';
};

type RequestFeedUser = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    location: string | null;
    skills?: string[];
    interests?: string[];
    openTo?: string[];
    messagePrivacy?: SuggestedProfile['messagePrivacy'];
    canSendMessage?: boolean;
    lastActiveAt?: string | null;
};

export type RequestConnectionItem = {
    id: string;
    type: 'requests_incoming' | 'requests_sent';
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    message?: string | null;
    mutualCount?: number;
    user: RequestFeedUser;
};

type FeedItemByTab = {
    network: NetworkConnectionItem;
    discover: DiscoverConnectionItem;
    requests_incoming: RequestConnectionItem;
    requests_sent: RequestConnectionItem;
};

type FeedPage<T> = {
    success: true;
    items: T[];
    hasMore: boolean;
    nextCursor: string | null;
    stats: FeedStats & { connectionsThisMonth?: number; connectionsGained?: number };
    viewerProjectIds?: string[];
    viewerSkills?: string[];
    viewerLocation?: string | null;
    lanePreferences?: Record<string, number>;
};

type FeedErrorPage = {
    success: false;
    error?: string;
    items: [];
    hasMore: false;
    nextCursor: null;
    stats: FeedStats;
};

export type PendingIncomingRequest = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    requesterUsername: string | null;
    requesterFullName: string | null;
    requesterAvatarUrl: string | null;
    requesterHeadline: string | null;
    requesterLocation?: string | null;
    requesterSkills?: string[];
    requesterOpenTo?: string[];
    requesterMessagePrivacy?: SuggestedProfile['messagePrivacy'];
    requesterCanSendMessage?: boolean;
    requesterLastActiveAt?: string | null;
    message?: string | null;
    mutualCount?: number;
};

export type PendingSentRequest = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    addresseeUsername: string | null;
    addresseeFullName: string | null;
    addresseeAvatarUrl: string | null;
    addresseeHeadline: string | null;
    addresseeLocation?: string | null;
    addresseeSkills?: string[];
    addresseeOpenTo?: string[];
    addresseeMessagePrivacy?: SuggestedProfile['messagePrivacy'];
    addresseeCanSendMessage?: boolean;
    addresseeLastActiveAt?: string | null;
};

export type PendingRequestsData = {
    incoming: PendingIncomingRequest[];
    sent: PendingSentRequest[];
    hasMoreIncoming: boolean;
    hasMoreSent: boolean;
    stats: FeedStats;
};

export type RequestHistoryConnectionItem = ConnectionRequestHistoryItem & {
    source: 'connection';
};

export type RequestHistoryApplicationItem = ApplicationRequestHistoryItem & {
    source: 'application';
};

export type RequestHistoryItem = RequestHistoryConnectionItem | RequestHistoryApplicationItem;

export type RequestHistoryData = {
    items: RequestHistoryItem[];
    warning?: string | null;
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
    requestHistory: (limit: number) => ['connections', 'request-history', limit] as const,
    suggestions: (limit: number, search?: string) => ['connections', 'suggestions', limit, search || ''] as const,
    stats: (userId: string) => ['connections', 'stats', userId] as const,
};

function normalizeFeedResult<T>(result: FeedPage<T> | FeedErrorPage): FeedPage<T> {
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

type DiscoverFeedSnapshot = Array<[QueryKey, InfiniteData<FeedPage<DiscoverConnectionItem>>]>;

function collectDiscoverFeedSnapshots(
    queryClient: ReturnType<typeof useQueryClient>,
): DiscoverFeedSnapshot {
    return queryClient
        .getQueriesData<InfiniteData<FeedPage<DiscoverConnectionItem>>>({
            queryKey: ['connections', 'feed', 'discover'],
        })
        .filter((entry): entry is [QueryKey, InfiniteData<FeedPage<DiscoverConnectionItem>>] => Boolean(entry[1]));
}

function restoreDiscoverFeedSnapshots(
    queryClient: ReturnType<typeof useQueryClient>,
    snapshots: DiscoverFeedSnapshot,
) {
    for (const [key, data] of snapshots) {
        queryClient.setQueryData(key, data);
    }
}

function updateStatsQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (stats: FeedStats) => FeedStats,
) {
    const keys = queryClient.getQueriesData<FeedStats>({
        queryKey: ['connections', 'stats'],
    });

    for (const [key, value] of keys) {
        if (!value) continue;
        queryClient.setQueryData(
            key,
            updater({
                totalConnections: Number(value.totalConnections || 0),
                pendingIncoming: Number(value.pendingIncoming || 0),
                pendingSent: Number(value.pendingSent || 0),
            }),
        );
    }
}

function updatePendingRequestQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (prev: PendingRequestsData) => PendingRequestsData,
) {
    queryClient.setQueriesData<PendingRequestsData>(
        { queryKey: ['connections', 'pending-requests'] },
        (prev) => {
            if (!prev) return prev;
            return updater(prev);
        },
    );
}

function patchDiscoverAndSuggestionStatus(
    queryClient: ReturnType<typeof useQueryClient>,
    input: {
        userIds?: Iterable<string | null | undefined>;
        connectionIds?: Iterable<string | null | undefined>;
        status: DiscoverConnectionItem['connectionStatus'];
        canConnect: boolean;
        connectionId?: string;
    },
) {
    const userIds = new Set(Array.from(input.userIds ?? []).filter((id): id is string => !!id));
    const connectionIds = new Set(Array.from(input.connectionIds ?? []).filter((id): id is string => !!id));
    const patch = (item: DiscoverConnectionItem): DiscoverConnectionItem => {
        if (!userIds.has(item.id) && (!item.connectionId || !connectionIds.has(item.connectionId))) {
            return item;
        }
        return {
            ...item,
            connectionStatus: input.status,
            canConnect: input.canConnect,
            connectionId: input.connectionId,
        };
    };

    updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
        ...page,
        items: page.items.map(patch),
    }));

    for (const queryKey of [
        ['connections', 'suggestions'],
        ['connections', 'mutual-suggestions'],
        ['connections', 'role-suggestions'],
    ] as const) {
        queryClient.setQueriesData({ queryKey }, (old: any) => {
            if (!old?.pages) return old;
            return {
                ...old,
                pages: old.pages.map((page: any) => ({
                    ...page,
                    items: page.items?.map(patch),
                })),
            };
        });
    }
}

function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'network'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_incoming'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_sent'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
}

async function cancelConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    await Promise.all([
        queryClient.cancelQueries({ queryKey: ['connections', 'feed'] }),
        queryClient.cancelQueries({ queryKey: ['connections', 'pending-requests'] }),
        queryClient.cancelQueries({ queryKey: ['connections', 'stats'] }),
    ]);
}

export function useConnectionsFeed<TTab extends ConnectionsFeedTab>(
    tab: TTab,
    options?: {
        limit?: number;
        search?: string;
        sortBy?: 'recent' | 'name' | 'oldest';
        enabled?: boolean;
        filters?: DiscoverFilters;
        historyFilters?: HistoryFilters;
        requestSortBy?: 'recent' | 'mutual' | 'oldest';
        tagFilter?: string;
    },
) {
    const limit = options?.limit ?? 20;
    const search = options?.search;
    const sortBy = options?.sortBy;
    const enabled = options?.enabled ?? true;
    const filters = options?.filters;
    const historyFilters = options?.historyFilters;
    const requestSortBy = options?.requestSortBy;
    const tagFilter = options?.tagFilter;

    // 2J: Include filters and requestSortBy in queryKey for cache separation
    const filtersKey = filters ? JSON.stringify(filters) : '';
    const requestSortKey = requestSortBy || '';
    const tagFilterKey = tagFilter || '';

    return useInfiniteQuery({
        queryKey: [...CONNECTIONS_QUERY_KEYS.feed(tab, limit, search), sortBy || 'recent', filtersKey, requestSortKey, tagFilterKey] as const,
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await getConnectionsFeed({
                tab,
                limit,
                search,
                sortBy,
                cursor: pageParam,
                filters,
                historyFilters,
                requestSortBy,
                tagFilter,
            } satisfies ConnectionsFeedInput);

            return normalizeFeedResult(result as FeedPage<FeedItemByTab[TTab]> | FeedErrorPage);
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
        staleTime: tab === 'network' ? 30_000 : 60_000,
        gcTime: 5 * 60_000,
        enabled,
    });
}

export function useConnections(limit = 50, search?: string, sortBy?: 'recent' | 'name' | 'oldest', tagFilter?: string) {
    return useConnectionsFeed('network', { limit, search, sortBy, tagFilter });
}

export function useSuggestedPeople(limit = 20, search?: string, filters?: DiscoverFilters) {
    const query = useConnectionsFeed('discover', { limit, search, filters });
    const { data, isFetching, fetchNextPage } = query;
    const filtersKey = filters ? JSON.stringify(filters) : '';

    // 2B: Prefetch page 2 after first page loads
    const hasPrefetched = useRef(false);
    useEffect(() => {
        hasPrefetched.current = false;
    }, [limit, search, filtersKey]);

    useEffect(() => {
        const firstPage = data?.pages[0];
        if (
            data?.pages.length === 1 &&
            firstPage?.nextCursor &&
            !hasPrefetched.current &&
            !isFetching
        ) {
            hasPrefetched.current = true;
            void fetchNextPage();
        }
    }, [data?.pages, fetchNextPage, isFetching]);

    return query;
}

function mapIncomingRequest(item: RequestConnectionItem): PendingIncomingRequest {
    return {
        id: item.id,
        requesterId: item.requesterId,
        addresseeId: item.addresseeId,
        status: item.status,
        createdAt: item.createdAt,
        requesterUsername: item.user.username,
        requesterFullName: item.user.fullName,
        requesterAvatarUrl: item.user.avatarUrl,
        requesterHeadline: item.user.headline,
        requesterLocation: item.user.location,
        requesterSkills: item.user.skills ?? [],
        requesterOpenTo: item.user.openTo ?? [],
        requesterMessagePrivacy: item.user.messagePrivacy ?? 'connections',
        requesterCanSendMessage: item.user.canSendMessage ?? false,
        requesterLastActiveAt: item.user.lastActiveAt ?? null,
        message: (item as RequestConnectionItem & { message?: string | null }).message ?? null,
        mutualCount: (item as RequestConnectionItem & { mutualCount?: number }).mutualCount,
    };
}

function mapSentRequest(item: RequestConnectionItem): PendingSentRequest {
    return {
        id: item.id,
        requesterId: item.requesterId,
        addresseeId: item.addresseeId,
        status: item.status,
        createdAt: item.createdAt,
        addresseeUsername: item.user.username,
        addresseeFullName: item.user.fullName,
        addresseeAvatarUrl: item.user.avatarUrl,
        addresseeHeadline: item.user.headline,
        addresseeLocation: item.user.location,
        addresseeSkills: item.user.skills ?? [],
        addresseeOpenTo: item.user.openTo ?? [],
        addresseeMessagePrivacy: item.user.messagePrivacy ?? 'connections',
        addresseeCanSendMessage: item.user.canSendMessage ?? false,
        addresseeLastActiveAt: item.user.lastActiveAt ?? null,
    };
}

export function usePendingRequests(limit = 20) {
    return useQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.pendingRequests(limit),
        queryFn: async (): Promise<PendingRequestsData> => {
            const [incoming, sent] = await Promise.all([
                getConnectionsFeed({ tab: 'requests_incoming', limit }),
                getConnectionsFeed({ tab: 'requests_sent', limit }),
            ]);

            const incomingOk = incoming.success
                ? (incoming as FeedPage<RequestConnectionItem>)
                : { items: [], hasMore: false, nextCursor: null, stats: EMPTY_STATS };
            const sentOk = sent.success
                ? (sent as FeedPage<RequestConnectionItem>)
                : { items: [], hasMore: false, nextCursor: null, stats: EMPTY_STATS };

            return {
                incoming: incomingOk.items.map(mapIncomingRequest),
                sent: sentOk.items.map(mapSentRequest),
                hasMoreIncoming: incomingOk.hasMore,
                hasMoreSent: sentOk.hasMore,
                stats: incomingOk.stats || sentOk.stats || EMPTY_STATS,
            };
        },
        staleTime: 45_000,
        gcTime: 5 * 60 * 1000,
    });
}

export type RequestHistoryPage = {
    groupedConnectionItems?: { label: string; items: RequestHistoryConnectionItem[] }[];
    items: RequestHistoryItem[];
    hasMore: boolean;
    nextCursor: string | null;
    warning?: string | null;
};

export function useRequestHistory(limit = 40, historyFilters?: HistoryFilters) {
    const filtersKey = historyFilters ? JSON.stringify(historyFilters) : '';
    return useInfiniteQuery({
        queryKey: [...CONNECTIONS_QUERY_KEYS.requestHistory(limit), filtersKey] as const,
        queryFn: async ({ pageParam }: { pageParam: string | undefined }): Promise<RequestHistoryPage> => {
            const [connectionsHistory, applicationsHistory] = await Promise.all([
                getConnectionRequestHistory(limit, pageParam, historyFilters),
                // Applications don't paginate in sync — only fetch on first page
                pageParam ? Promise.resolve({ success: true as const, items: [] }) : getApplicationRequestHistory(limit),
            ]);

            const failures: string[] = [];
            if (!connectionsHistory.success) {
                failures.push(`connections: ${connectionsHistory.error || 'unknown error'}`);
            }
            if (!applicationsHistory.success) {
                failures.push(`applications: ${applicationsHistory.error || 'unknown error'}`);
            }
            if (failures.length === 2) {
                throw new Error(`Failed to load request history (${failures.join('; ')})`);
            }
            if (failures.length > 0) {
                console.error('Partial request history fetch failure', { failures });
            }

            const connectionItems = connectionsHistory.success
                ? connectionsHistory.items.map<RequestHistoryConnectionItem>((item) => ({
                    ...item,
                    source: 'connection',
                }))
                : [];

            const applicationItems = applicationsHistory.success
                ? applicationsHistory.items.map<RequestHistoryApplicationItem>((item) => ({
                    ...item,
                    source: 'application',
                }))
                : [];

            const items = [...connectionItems, ...applicationItems]
                .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

            const hasMore = connectionsHistory.success && 'hasMore' in connectionsHistory
                ? !!(connectionsHistory as { hasMore?: boolean }).hasMore
                : connectionItems.length >= limit;
            const nextCursor = connectionsHistory.success && 'nextCursor' in connectionsHistory
                ? (connectionsHistory as { nextCursor?: string | null }).nextCursor ?? null
                : null;

            const groupedConnectionItems = connectionsHistory.success && 'groupedItems' in connectionsHistory
                ? (connectionsHistory as any).groupedItems.map((group: any) => ({
                    label: group.label,
                    items: group.items.map((item: any) => ({ ...item, source: 'connection' as const }))
                }))
                : [];

            return {
                items,
                groupedConnectionItems,
                hasMore,
                nextCursor,
                warning: failures.length > 0 ? failures.join('; ') : null,
            };
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
        staleTime: 20_000,
    });
}

export function useConnectionStats(userId?: string) {
    const scope = userId || 'me';
    return useQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.stats(scope),
        queryFn: () => getConnectionStats(userId),
        staleTime: 60_000,
    });
}

// 2G: Mutual connections list query (lazy)
export function useMutualConnections(userId: string | null, enabled = false) {
    return useQuery({
        queryKey: ['connections', 'mutual-list', userId] as const,
        queryFn: async () => {
            if (!userId) return { users: [] };
            // TODO: Implement a dedicated server-side mutual connections endpoint.
            // Until then, avoid making placeholder network requests for an empty result.
            return { users: [] as Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }> };
        },
        enabled: enabled && !!userId,
        staleTime: 5 * 60_000,
    });
}

export function useConnectionMutations() {
    const queryClient = useQueryClient();

    const invalidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const invalidateAll = useCallback((targetId?: string) => {
        if (invalidateTimeoutRef.current) {
            clearTimeout(invalidateTimeoutRef.current);
        }
        invalidateTimeoutRef.current = setTimeout(() => {
            invalidateConnectionsScoped(queryClient);
            if (targetId) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetId) });
            }
            invalidateTimeoutRef.current = null;
        }, 150);
    }, [queryClient]);

    useEffect(() => {
        return () => {
            if (invalidateTimeoutRef.current) {
                clearTimeout(invalidateTimeoutRef.current);
            }
        };
    }, []);

    const sendRequest = useMutation({
        mutationFn: async ({ userId, message, lane }: { userId: string; message?: string; lane?: string }) => {
            const idempotencyKey = crypto.randomUUID();
            const result = await sendConnectionRequest(userId, idempotencyKey, message, lane);
            if (!result.success) throw new Error(result.error || 'Failed to send request');
            return { ...result, userId };
        },
        onMutate: async ({ userId }) => {
            await cancelConnectionsScoped(queryClient);

            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: [userId],
                status: 'pending_sent',
                canConnect: false,
            });

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: stats.pendingSent + 1,
            }));
        },
        onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
        onSuccess: (result) => {
            if (result.status !== 'created') {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingSent: Math.max(0, stats.pendingSent - 1),
                }));
            }

            const nextStatus =
                result.status === 'connected'
                    ? 'connected'
                    : result.status === 'pending_received'
                        ? 'pending_received'
                        : result.status === 'pending_sent' || result.status === 'created'
                            ? 'pending_sent'
                            : null;

            if (!nextStatus) return;

            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: [result.userId],
                connectionIds: result.connectionId ? [result.connectionId] : [],
                status: nextStatus,
                canConnect: false,
                connectionId: result.connectionId,
            });
        },
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const cancelRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await cancelConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to cancel request');
            return { ...result, id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            let targetUserId: string | undefined;
            updatePendingRequestQueries(queryClient, (prev) => {
                const request = prev.sent.find((item) => item.id === id);
                targetUserId = request?.addresseeId;
                return {
                    ...prev,
                    sent: prev.sent.filter((item) => item.id !== id),
                };
            });

            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: targetUserId ? [targetUserId] : [],
                connectionIds: [id],
                status: 'none',
                canConnect: true,
                connectionId: undefined,
            });

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: Math.max(0, stats.pendingSent - 1),
            }));

            return { targetUserId };
        },
        onSuccess: (result, id, context) => {
            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: [result.addresseeId, context?.targetUserId],
                connectionIds: [result.connectionId, id],
                status: 'none',
                canConnect: true,
                connectionId: undefined,
            });
        },
        onError: (_err, _vars, context) => invalidateAll(context?.targetUserId),
        onSettled: (data, _err, _vars, context) => invalidateAll(data?.addresseeId || context?.targetUserId),
    });

    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id, { idempotencyKey: id });
            if (!result.success) throw new Error(result.error || 'Failed to accept request');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);

            // Find the pending request to get user details for network insert
            let acceptedConnection: NetworkConnectionItem | null = null;
            updatePendingRequestQueries(queryClient, (prev) => {
                const req = prev.incoming.find(r => r.id === id);
                if (req) {
                    acceptedConnection = {
                        id,
                        type: 'network',
                        requesterId: req.requesterId,
                        addresseeId: req.addresseeId,
                        status: 'accepted',
                        createdAt: req.createdAt,
                        updatedAt: new Date(),
                        tags: [],
                        otherUser: {
                            id: req.requesterId,
                            username: req.requesterUsername,
                            fullName: req.requesterFullName,
                            avatarUrl: req.requesterAvatarUrl,
                            headline: req.requesterHeadline,
                            location: req.requesterLocation ?? null,
                            skills: req.requesterSkills ?? [],
                            openTo: req.requesterOpenTo ?? [],
                            messagePrivacy: req.requesterMessagePrivacy ?? 'connections',
                            canSendMessage: true,
                            lastActiveAt: req.requesterLastActiveAt ?? null,
                        },
                    };
                }
                return {
                    ...prev,
                    incoming: prev.incoming.filter((item) => item.id !== id),
                };
            });

            if (acceptedConnection) {
                const nextAcceptedConnection = acceptedConnection;
                updateFeedQueries<NetworkConnectionItem>(queryClient, ['connections', 'feed', 'network'], (page) => ({
                    ...page,
                    items: [
                        nextAcceptedConnection,
                        ...page.items.filter((item) => item.id !== id),
                    ],
                }));
            }

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.connectionId === id
                        ? { ...item, connectionStatus: 'connected', canConnect: false }
                        : item
                ),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: stats.totalConnections + 1,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const rejectRequest = useMutation({
        mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
            const result = await rejectConnectionRequest(id, reason);
            if (!result.success) throw new Error(result.error || 'Failed to reject request');
            return { id, undoUntil: result.undoUntil, serverNow: result.serverNow };
        },
        onMutate: async ({ id }) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.id !== id),
            }));

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.connectionId === id
                        ? { ...item, connectionStatus: 'none', canConnect: true, connectionId: undefined }
                        : item
                ),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const dismissSuggestion = useMutation({
        mutationFn: async ({ profileId, feedbackReason }: { profileId: string; feedbackReason?: string }) => {
            const result = await dismissConnectionSuggestion(profileId, feedbackReason);
            if (!result.success) throw new Error(result.error || 'Failed to dismiss suggestion');
            return { profileId };
        },
        onMutate: async ({ profileId }) => {
            await cancelConnectionsScoped(queryClient);
            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== profileId),
            }));
        },
        onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const optimisticallyDismissSuggestion = async (profileId: string) => {
        await cancelConnectionsScoped(queryClient);
        const snapshots = collectDiscoverFeedSnapshots(queryClient);
        updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== profileId),
        }));
        return snapshots;
        };

    const restoreDismissedSuggestion = (snapshots: DiscoverFeedSnapshot) => {
        restoreDiscoverFeedSnapshots(queryClient, snapshots);
    };

    const undoRejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await undoRejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to undo reject');
            return { id };
        },
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const acceptAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await acceptAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to accept all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);

            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);

            let acceptedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                acceptedCount = Math.max(acceptedCount, prev.incoming.length);
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

            return { previousPending, previousStats };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            invalidateAll();
        },
        onSettled: () => invalidateAll(),
    });
    const withdrawAllSent = useMutation({
        mutationFn: async () => {
            const res = await withdrawAllSentConnectionRequests();
            if (!res.success) throw new Error(res.error || 'Failed to cancel requests');
            return res;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);

            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);
            const sentUserIds = new Set<string>();
            const sentConnectionIds = new Set<string>();
            let withdrawnCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                withdrawnCount = prev.sent.length;
                for (const request of prev.sent) {
                    sentUserIds.add(request.addresseeId);
                    sentConnectionIds.add(request.id);
                }
                return {
                    ...prev,
                    sent: [],
                };
            });

            if (withdrawnCount > 0) {
                patchDiscoverAndSuggestionStatus(queryClient, {
                    userIds: sentUserIds,
                    connectionIds: sentConnectionIds,
                    status: 'none',
                    canConnect: true,
                    connectionId: undefined,
                });

                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingSent: Math.max(0, stats.pendingSent - withdrawnCount),
                }));
            }

            return { previousPending, previousStats, sentUserIds, sentConnectionIds };
        },
        onSuccess: (result, _vars, context) => {
            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: context?.sentUserIds ?? [],
                connectionIds: context?.sentConnectionIds ?? [],
                status: 'none',
                canConnect: true,
                connectionId: undefined,
            });
            toast.success(result.count && result.count > 0 ? `Cancelled ${result.count} sent request${result.count === 1 ? '' : 's'}` : 'No sent requests to cancel');
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            toast.error("Failed to cancel sent requests");
        },
        onSettled: () => invalidateAll(),
    });

    const rejectAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await rejectAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to reject all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);

            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);

            let rejectedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                rejectedCount = Math.max(rejectedCount, prev.incoming.length);
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

            return { previousPending, previousStats };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            invalidateAll();
        },
        onSettled: () => invalidateAll(),
    });

    const disconnect = useMutation({
        mutationFn: async (id: string) => {
            const result = await removeConnection(id);
            if (!result.success) throw new Error(result.error || 'Failed to remove connection');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            updateFeedQueries<NetworkConnectionItem>(queryClient, ['connections', 'feed', 'network'], (page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== id),
            }));
            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.connectionId === id
                        ? { ...item, connectionStatus: 'none', canConnect: true, connectionId: undefined }
                        : item
                ),
            }));
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: Math.max(0, stats.totalConnections - 1),
            }));
        },
        onError: () => {
            // Re-fetch to restore the canonical sorted state on failure.
            invalidateAll();
        },
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const undoDismiss = useMutation({
        mutationFn: async (profileId: string) => {
            const result = await undoDismissConnectionSuggestion(profileId);
            if (!result.success) throw new Error(result.error || 'Failed to undo dismiss');
            return { profileId };
        },
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const updateTags = useMutation({
        mutationFn: async ({ connectionId, tags }: { connectionId: string; tags: string[] }) => {
            const result = await updateConnectionTags(connectionId, tags);
            if (!result.success) throw new Error(result.error || 'Failed to update tags');
            return { connectionId, tags };
        },
        onMutate: async ({ connectionId, tags }) => {
            await cancelConnectionsScoped(queryClient);
            updateFeedQueries<NetworkConnectionItem>(queryClient, ['connections', 'feed', 'network'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.id === connectionId ? { ...item, tags } : item,
                ),
            }));
        },
        onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const blockProfile = useMutation({
        mutationFn: async (targetUserId: string) => {
            const res = await fetch('/api/v1/privacy/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: targetUserId }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error?.message || data?.message || 'Failed to block account');
            }
            return { targetUserId };
        },
        onMutate: async (targetUserId) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.requesterId !== targetUserId),
                sent: prev.sent.filter((item) => item.addresseeId !== targetUserId),
            }));
        },
        onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),
    });

    const result = useMemo(() => ({
        sendRequest,
        cancelRequest,
        withdrawAllSent,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        optimisticallyDismissSuggestion,
        restoreDismissedSuggestion,
        undoDismiss,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        disconnect,
        updateTags,
        blockProfile,
    }), [
        sendRequest,
        cancelRequest,
        withdrawAllSent,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        optimisticallyDismissSuggestion,
        restoreDismissedSuggestion,
        undoDismiss,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        disconnect,
        updateTags,
        blockProfile,
    ]);

    return result;
}

export function useConnectionTags() {
    return useQuery({
        queryKey: ['connections', 'tags'],
        queryFn: async () => {
            const res = await getConnectionTags();
            if (!res.success) throw new Error(res.error || 'Failed to fetch tags');
            return res.tags;
        }
    });
}

export function useBulkConnectionsActions() {
    const queryClient = useQueryClient();

    const disconnect = useMutation({
        mutationFn: async (ids: string[]) => {
            const res = await bulkDisconnectConnections(ids);
            if (!res.success) throw new Error(res.error);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
        }
    });

    const updateTags = useMutation({
        mutationFn: async ({ ids, tags }: { ids: string[], tags: string[] }) => {
            const res = await bulkUpdateConnectionTags(ids, tags);
            if (!res.success) throw new Error(res.error);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'tags'] });
        }
    });

    return { disconnect, updateTags };
}

export function useMutualSuggestions(limit = 6, search?: string) {
    return useQuery({
        queryKey: ['connections', 'suggestions', 'mutual', limit, search || ''],
        queryFn: async () => {
            const res = await getMutualSuggestions(limit, search);
            if (!res.success) throw new Error(res.error);
            return res.items;
        }
    });
}

export function useRoleSuggestions(limit = 6, search?: string) {
    return useQuery({
        queryKey: ['connections', 'suggestions', 'role', limit, search || ''],
        queryFn: async () => {
            const res = await getRoleSuggestions(limit, search);
            if (!res.success) throw new Error(res.error);
            return res.items;
        }
    });
}
