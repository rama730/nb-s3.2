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
    getConnectionRequestHistory,
    getConnectionsFeed,
    rejectAllIncomingConnectionRequests,
    rejectConnectionRequest,
    removeConnection,
    sendConnectionRequest,
    undoRejectConnectionRequest,
    type ConnectionRequestHistoryItem,
    type ConnectionStats,
    type ConnectionsFeedInput,
    type ConnectionsFeedTab,
    type SuggestedProfile,
} from '@/app/actions/connections';
import {
    getApplicationRequestHistory,
    type ApplicationRequestHistoryItem,
} from '@/app/actions/applications';
import { useAuth } from '@/hooks/useAuth';
import { useRealtime } from '@/components/providers/RealtimeProvider';
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
    otherUser: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline: string | null;
        location: string | null;
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
};

export type RequestConnectionItem = {
    id: string;
    type: 'requests_incoming' | 'requests_sent';
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
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

function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
}

async function cancelConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    await Promise.all([
        queryClient.cancelQueries({ queryKey: ['connections', 'feed'] }),
        queryClient.cancelQueries({ queryKey: ['connections', 'pending-requests'] }),
        queryClient.cancelQueries({ queryKey: ['connections', 'stats'] }),
    ]);
}

type ConnectionsRealtimePayload = {
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
};

type ConnectionsRealtimeRow = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    updatedAt: Date;
};

function parseRealtimeConnectionRowFromSource(source?: Record<string, unknown>): ConnectionsRealtimeRow | null {
    if (!source) return null;

    const id = typeof source.id === 'string' ? source.id : null;
    const requesterId = typeof source.requester_id === 'string' ? source.requester_id : null;
    const addresseeId = typeof source.addressee_id === 'string' ? source.addressee_id : null;
    const status = typeof source.status === 'string' ? source.status : null;
    const updatedRaw = source.updated_at || source.updatedAt;
    const updatedAt = updatedRaw ? new Date(updatedRaw as string | number | Date) : new Date();

    if (!id || !requesterId || !addresseeId || !status) return null;

    return {
        id,
        requesterId,
        addresseeId,
        status,
        updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
    };
}

function parseRealtimeConnectionPair(payload: ConnectionsRealtimePayload): {
    previous: ConnectionsRealtimeRow | null;
    current: ConnectionsRealtimeRow | null;
} {
    return {
        previous: parseRealtimeConnectionRowFromSource(payload.old),
        current: parseRealtimeConnectionRowFromSource(payload.new),
    };
}

function rowCountersForViewer(row: ConnectionsRealtimeRow | null, userId: string) {
    if (!row) {
        return {
            pendingIncoming: 0,
            pendingSent: 0,
            totalConnections: 0,
        };
    }

    return {
        pendingIncoming: row.status === 'pending' && row.addresseeId === userId ? 1 : 0,
        pendingSent: row.status === 'pending' && row.requesterId === userId ? 1 : 0,
        totalConnections:
            row.status === 'accepted' && (row.requesterId === userId || row.addresseeId === userId)
                ? 1
                : 0,
    };
}

function clampStats(stats: FeedStats): FeedStats {
    return {
        totalConnections: Math.max(0, stats.totalConnections),
        pendingIncoming: Math.max(0, stats.pendingIncoming),
        pendingSent: Math.max(0, stats.pendingSent),
    };
}

function patchRealtimeStatsFromPayload(
    queryClient: ReturnType<typeof useQueryClient>,
    userId: string,
    payload: ConnectionsRealtimePayload
) {
    const pair = parseRealtimeConnectionPair(payload);
    const before = rowCountersForViewer(pair.previous, userId);
    const after = rowCountersForViewer(pair.current, userId);
    const delta = {
        totalConnections: after.totalConnections - before.totalConnections,
        pendingIncoming: after.pendingIncoming - before.pendingIncoming,
        pendingSent: after.pendingSent - before.pendingSent,
    };

    if (delta.totalConnections === 0 && delta.pendingIncoming === 0 && delta.pendingSent === 0) {
        return false;
    }

    updateStatsQueries(queryClient, (stats) =>
        clampStats({
            totalConnections: stats.totalConnections + delta.totalConnections,
            pendingIncoming: stats.pendingIncoming + delta.pendingIncoming,
            pendingSent: stats.pendingSent + delta.pendingSent,
        })
    );

    queryClient.setQueriesData<PendingRequestsData>(
        { queryKey: ['connections', 'pending-requests'] },
        (prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                stats: clampStats({
                    totalConnections: Number(prev.stats?.totalConnections || 0) + delta.totalConnections,
                    pendingIncoming: Number(prev.stats?.pendingIncoming || 0) + delta.pendingIncoming,
                    pendingSent: Number(prev.stats?.pendingSent || 0) + delta.pendingSent,
                }),
            };
        }
    );

    updateFeedQueries<unknown>(queryClient, ['connections', 'feed'], (page) => ({
        ...page,
        stats: clampStats({
            totalConnections: Number(page.stats?.totalConnections || 0) + delta.totalConnections,
            pendingIncoming: Number(page.stats?.pendingIncoming || 0) + delta.pendingIncoming,
            pendingSent: Number(page.stats?.pendingSent || 0) + delta.pendingSent,
        }),
    }));

    return true;
}

function resolveDiscoverStatus(
    row: ConnectionsRealtimeRow,
    userId: string
): DiscoverConnectionItem['connectionStatus'] {
    if (row.status === 'accepted') return 'connected';
    if (row.status === 'pending') {
        return row.requesterId === userId ? 'pending_sent' : 'pending_received';
    }
    return 'none';
}

function patchConnectionsRealtimeCaches(
    queryClient: ReturnType<typeof useQueryClient>,
    userId: string,
    payload: ConnectionsRealtimePayload
) {
    const pair = parseRealtimeConnectionPair(payload);
    const row = pair.current || pair.previous;
    if (!row) {
        return {
            patched: false,
            networkChanged: false,
            discoverChanged: false,
            requestsIncomingChanged: false,
            requestsSentChanged: false,
            pendingRequestsChanged: false,
            affectsNetwork: false,
            affectsRequestsIncoming: false,
            affectsRequestsSent: false,
            affectsPendingRequests: false,
        };
    }

    const otherUserId =
        row.requesterId === userId
            ? row.addresseeId
            : row.addresseeId === userId
                ? row.requesterId
                : null;

    const affectsNetwork = [pair.previous, pair.current].some(
        (candidate) =>
            !!candidate &&
            (candidate.requesterId === userId || candidate.addresseeId === userId) &&
            candidate.status === 'accepted'
    );
    const affectsRequestsIncoming = [pair.previous, pair.current].some(
        (candidate) => !!candidate && candidate.addresseeId === userId && candidate.status === 'pending'
    );
    const affectsRequestsSent = [pair.previous, pair.current].some(
        (candidate) => !!candidate && candidate.requesterId === userId && candidate.status === 'pending'
    );
    const affectsPendingRequests = affectsRequestsIncoming || affectsRequestsSent;

    const feedQueries = queryClient.getQueriesData<InfiniteData<FeedPage<unknown>>>({
        queryKey: ['connections', 'feed'],
    });

    let patched = false;
    let networkChanged = false;
    let discoverChanged = false;
    let requestsIncomingChanged = false;
    let requestsSentChanged = false;
    let pendingRequestsChanged = false;

    for (const [queryKey, data] of feedQueries) {
        if (!data) continue;
        const tab = Array.isArray(queryKey) ? queryKey[2] : null;
        if (
            tab !== 'network' &&
            tab !== 'discover' &&
            tab !== 'requests_incoming' &&
            tab !== 'requests_sent'
        ) {
            continue;
        }

        let queryChanged = false;
        const nextPages = data.pages.map((page) => {
            if (!Array.isArray(page.items)) return page;
            let pageChanged = false;

            const nextItems = page.items.map((item) => {
                if (!item || typeof item !== 'object') return item;
                const itemRecord = item as Record<string, unknown>;
                const itemId = typeof itemRecord.id === 'string' ? itemRecord.id : null;
                if (!itemId) return item;

                if (tab === 'network') {
                    if (itemId !== row.id) return item;
                    if (row.status !== 'accepted') return null;
                    pageChanged = true;
                    return {
                        ...item,
                        status: row.status,
                        updatedAt: row.updatedAt,
                    };
                }

                if (tab === 'discover') {
                    if (!otherUserId || itemId !== otherUserId) return item;
                    pageChanged = true;
                    const nextStatus = resolveDiscoverStatus(row, userId);
                    return {
                        ...item,
                        connectionStatus: nextStatus,
                        canConnect: nextStatus === 'none',
                    };
                }

                if (tab === 'requests_incoming') {
                    if (itemId !== row.id || row.addresseeId !== userId) return item;
                    if (row.status !== 'pending') return null;
                    pageChanged = true;
                    return {
                        ...item,
                        status: row.status,
                        updatedAt: row.updatedAt,
                    };
                }

                if (tab === 'requests_sent') {
                    if (itemId !== row.id || row.requesterId !== userId) return item;
                    if (row.status !== 'pending') return null;
                    pageChanged = true;
                    return {
                        ...item,
                        status: row.status,
                        updatedAt: row.updatedAt,
                    };
                }

                return item;
            }).filter(Boolean);

            if (nextItems.length !== page.items.length || pageChanged) {
                queryChanged = true;
                return {
                    ...page,
                    items: nextItems,
                };
            }

            return page;
        });

        if (queryChanged) {
            patched = true;
            if (tab === 'network') networkChanged = true;
            if (tab === 'discover') discoverChanged = true;
            if (tab === 'requests_incoming') requestsIncomingChanged = true;
            if (tab === 'requests_sent') requestsSentChanged = true;
            queryClient.setQueryData<InfiniteData<FeedPage<unknown>>>(queryKey, {
                ...data,
                pages: nextPages,
            });
        }
    }

    const shouldAffectIncoming = row.addresseeId === userId;
    const shouldAffectSent = row.requesterId === userId;

    if (shouldAffectIncoming || shouldAffectSent) {
        updatePendingRequestQueries(queryClient, (prev) => {
            let changed = false;
            const incoming = prev.incoming.filter((item) => {
                if (item.id !== row.id) return true;
                if (shouldAffectIncoming && row.status !== 'pending') {
                    changed = true;
                    return false;
                }
                return true;
            });

            const sent = prev.sent.filter((item) => {
                if (item.id !== row.id) return true;
                if (shouldAffectSent && row.status !== 'pending') {
                    changed = true;
                    return false;
                }
                return true;
            });

            if (!changed) return prev;

            patched = true;
            pendingRequestsChanged = true;
            return {
                ...prev,
                incoming,
                sent,
            };
        });
    }

    return {
        patched,
        networkChanged,
        discoverChanged,
        requestsIncomingChanged,
        requestsSentChanged,
        pendingRequestsChanged,
        affectsNetwork,
        affectsRequestsIncoming,
        affectsRequestsSent,
        affectsPendingRequests,
    };
}

export function useConnectionsRealtimeInvalidation() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const { subscribeUserNotifications } = useRealtime();
    const userId = user?.id;
    const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!userId) return;

        const scheduleInvalidate = (payload: ConnectionsRealtimePayload) => {
            const patchResult = patchConnectionsRealtimeCaches(queryClient, userId, payload);
            const statsPatched = patchRealtimeStatsFromPayload(queryClient, userId, payload);
            if (patchResult.patched) {
                if (!statsPatched) {
                    queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
                }
                queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });

                if (patchResult.affectsNetwork && !patchResult.networkChanged) {
                    queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'network'] });
                }
                if (patchResult.affectsRequestsIncoming && !patchResult.requestsIncomingChanged) {
                    queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_incoming'] });
                }
                if (patchResult.affectsRequestsSent && !patchResult.requestsSentChanged) {
                    queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_sent'] });
                }
                if (patchResult.affectsPendingRequests && !patchResult.pendingRequestsChanged) {
                    queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
                }
                return;
            }

            if (invalidateTimerRef.current) return;
            invalidateTimerRef.current = setTimeout(() => {
                invalidateTimerRef.current = null;
                invalidateConnectionsScoped(queryClient);
            }, 250);
        };

        const unsubscribe = subscribeUserNotifications((event) => {
            if (event.kind === 'connection') {
                scheduleInvalidate(event.payload as ConnectionsRealtimePayload);
            }
        });

        return () => {
            if (invalidateTimerRef.current) {
                clearTimeout(invalidateTimerRef.current);
                invalidateTimerRef.current = null;
            }
            unsubscribe();
        };
    }, [queryClient, subscribeUserNotifications, userId]);
}

export function useConnectionsFeed<TTab extends ConnectionsFeedTab>(
    tab: TTab,
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

            return normalizeFeedResult(result as FeedPage<FeedItemByTab[TTab]> | FeedErrorPage);
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
    };
}

export function usePendingRequests(limit = 20) {
    const { isConnected } = useRealtime();
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
        refetchInterval: isConnected ? false : 30_000,
    });
}

export function useRequestHistory(limit = 80) {
    const { isConnected } = useRealtime();
    return useQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.requestHistory(limit),
        queryFn: async (): Promise<RequestHistoryData> => {
            const [connectionsHistory, applicationsHistory] = await Promise.all([
                getConnectionRequestHistory(limit),
                getApplicationRequestHistory(limit),
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
                .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime())
                .slice(0, limit);

            return {
                items,
                warning: failures.length > 0 ? failures.join('; ') : null,
            };
        },
        staleTime: 20_000,
        refetchInterval: isConnected ? false : 30_000,
    });
}

export function useConnectionStats(userId?: string) {
    const { isConnected } = useRealtime();
    const scope = userId || 'me';
    return useQuery({
        queryKey: CONNECTIONS_QUERY_KEYS.stats(scope),
        queryFn: () => getConnectionStats(userId),
        staleTime: 60_000,
        refetchInterval: userId || isConnected ? false : 60_000,
    });
}

export function useConnectionMutations() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    const invalidateAll = () => {
        invalidateConnectionsScoped(queryClient);
        if (user?.id) {
            queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(user.id) });
        }
    };

    const sendRequest = useMutation({
        mutationFn: async ({ userId, message }: { userId: string; message?: string }) => {
            const result = await sendConnectionRequest(userId, message);
            if (!result.success) throw new Error(result.error || 'Failed to send request');
            return { ...result, userId };
        },
        onMutate: async ({ userId }) => {
            await cancelConnectionsScoped(queryClient);

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
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
        onError: invalidateAll,
        onSettled: invalidateAll,
    });

    const cancelRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await cancelConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to cancel request');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                sent: prev.sent.filter((item) => item.id !== id),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: Math.max(0, stats.pendingSent - 1),
            }));
        },
        onError: invalidateAll,
        onSettled: invalidateAll,
    });

    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to accept request');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.id !== id),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: stats.totalConnections + 1,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: invalidateAll,
        onSettled: invalidateAll,
    });

    const rejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await rejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to reject request');
            return { id, undoUntil: result.undoUntil };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.id !== id),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: invalidateAll,
        onSettled: invalidateAll,
    });

    const dismissSuggestion = useMutation({
        mutationFn: async (profileId: string) => {
            const result = await dismissConnectionSuggestion(profileId);
            if (!result.success) throw new Error(result.error || 'Failed to dismiss suggestion');
            return { profileId };
        },
        onMutate: async (profileId) => {
            await cancelConnectionsScoped(queryClient);
            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== profileId),
            }));
        },
        onError: invalidateAll,
        onSettled: invalidateAll,
    });

    const undoRejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await undoRejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to undo reject');
            return { id };
        },
        onSettled: invalidateAll,
    });

    const acceptAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await acceptAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to accept all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);
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
        },
        onSettled: invalidateAll,
    });

    const rejectAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await rejectAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to reject all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);
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
        },
        onSettled: invalidateAll,
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
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: Math.max(0, stats.totalConnections - 1),
            }));
        },
        onError: invalidateAll,
        onSettled: invalidateAll,
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
