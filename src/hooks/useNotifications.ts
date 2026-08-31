"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
    type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";

import {
    dismissNotificationAction,
    markNotificationReadAction,
    markNotificationUnreadAction,
    markNotificationsSeenAction,
    muteNotificationScopeAction,
    readNotificationUnreadCountAction,
    readNotificationsAction,
    snoozeNotificationAction,
} from "@/app/actions/notifications";
import {
    markNotificationsSeenInInfiniteData,
    patchNotificationReadStateInInfiniteData,
    removeNotificationFromInfiniteData,
    upsertNotificationInInfiniteData,
} from "@/lib/notifications/cache";
import {
    getNotificationReason,
    buildNotificationHref,
    getNarrowestNotificationMuteScope,
    shouldSuppressNotificationToast,
} from "@/lib/notifications/presentation";
import { showBrowserNotification } from "@/lib/notifications/browser-push";
import { useNotificationPreferences } from "@/hooks/useSettingsQueries";
import type {
    NotificationFeedPage,
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query-keys";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { useAuth } from "@/lib/hooks/use-auth";
import { useMessagesV2UiStore } from "@/stores/messagesV2UiStore";
import { recordMessagesOpen } from "@/lib/messages/observability";

const DEFAULT_LIMIT = 20;
// Mirrors the server-side upper bound in markNotificationsSeen. Keeping the
// client batches within it prevents a large review session from being marked
// optimistically while only its first 50 rows are persisted.
const QUALIFIED_VIEW_BATCH_SIZE = 50;
const TOAST_BATCH_MS = 1_200;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const IDLE_FLUSH_DEBOUNCE_MS = 400;

function normalizeRealtimeNotificationRow(value: unknown): NotificationItem | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : null;
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    const kind = typeof row.kind === "string" ? row.kind : null;
    const importance = typeof row.importance === "string" ? row.importance : "more";
    const title = typeof row.title === "string" ? row.title : null;
    const dedupeKey = typeof row.dedupe_key === "string" ? row.dedupe_key : null;
    const createdAt = typeof row.created_at === "string" ? row.created_at : null;
    const updatedAt = typeof row.updated_at === "string" ? row.updated_at : createdAt;
    const activityAt = typeof row.activity_at === "string" ? row.activity_at : updatedAt;
    if (!id || !userId || !kind || !title || !dedupeKey || !createdAt || !updatedAt || !activityAt) {
        return null;
    }
    const entityRefs = row.entity_refs && typeof row.entity_refs === "object" ? row.entity_refs as NotificationItem["entityRefs"] : null;

    return {
        id,
        userId,
        actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
        kind: kind as NotificationItem["kind"],
        importance: importance as NotificationItem["importance"],
        title,
        body: typeof row.body === "string" ? row.body : null,
        href: typeof row.href === "string" ? row.href : null,
        entityRefs,
        preview: row.preview && typeof row.preview === "object" ? row.preview as NotificationItem["preview"] : null,
        reason: getNotificationReason(kind as NotificationItem["kind"], entityRefs),
        dedupeKey,
        aggregateCount: typeof row.aggregate_count === "number" ? row.aggregate_count : 1,
        readAt: typeof row.read_at === "string" ? row.read_at : null,
        seenAt: typeof row.seen_at === "string" ? row.seen_at : null,
        dismissedAt: typeof row.dismissed_at === "string" ? row.dismissed_at : null,
        createdAt,
        activityAt,
        updatedAt,
        snoozedUntil: typeof row.snoozed_until === "string" ? row.snoozed_until : null,
    };
}

function isActivelySnoozed(item: NotificationItem | null): boolean {
    if (!item?.snoozedUntil) return false;
    const until = new Date(item.snoozedUntil);
    return !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
}

function isUnreadVisible(item: NotificationItem | null) {
    return Boolean(item && !item.seenAt && !item.dismissedAt);
}

type UnreadCounts = { total: number; important: number };

const ZERO_COUNTS: UnreadCounts = { total: 0, important: 0 };

function deriveUnreadCounts(data: InfiniteData<NotificationFeedPage> | undefined): UnreadCounts {
    if (!data) return ZERO_COUNTS;
    const head = data.pages[0];
    if (head && (head.unreadCount > 0 || head.unreadImportantCount > 0)) {
        return { total: head.unreadCount, important: head.unreadImportantCount };
    }
    const unread = data.pages.flatMap((page) => page.items).filter((item) => !item.seenAt && !item.dismissedAt);
    return {
        total: unread.length,
        important: unread.filter((item) => item.importance === "important").length,
    };
}

export function useNotificationUnreadCount() {
    const { user, isAuthenticated } = useAuth();
    const query = useQuery<UnreadCounts>({
        queryKey: queryKeys.notifications.unreadCount(),
        enabled: Boolean(isAuthenticated && user?.id),
        queryFn: async () => {
            const result = await readNotificationUnreadCountAction();
            if (!result.success) {
                throw new Error(result.error || "Failed to load notification count");
            }
            return { total: result.unreadCount, important: result.unreadImportantCount };
        },
        staleTime: 15_000,
    });
    const counts = query.data ?? ZERO_COUNTS;
    return { unreadCount: counts.total, unreadImportantCount: counts.important };
}

export function useNotifications(limit: number = DEFAULT_LIMIT) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const pathname = usePathname();
    const { user, isAuthenticated } = useAuth();
    const { isConnected, notificationStatus, subscribeUserNotifications } = useRealtime();
    const [isTrayOpen, setIsTrayOpen] = useState(false);
    const [activeFilter, setActiveFilter] = useState<NotificationTrayFilter>("unread");
    const [isIdle, setIsIdle] = useState(false);
    const activePopupConversationId = useMessagesV2UiStore((state) =>
        state.popupState === "open" ? state.selectedConversationId : null,
    );
    const isTrayOpenRef = useRef(false);
    const viewedNotificationIdsRef = useRef(new Set<string>());
    const toastQueueRef = useRef<NotificationItem[]>([]);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queueImportantToastRef = useRef<(item: NotificationItem) => void>(() => { });
    const isIdleRef = useRef(false);
    const browserDeliveryEnabledRef = useRef<boolean>(false);
    const preferencesQuery = useNotificationPreferences({
        // Browser delivery is evaluated when a realtime row arrives. Fetching
        // it only while the tray is open made the preference ineffective for
        // the normal (closed-bell) state.
        enabled: Boolean(isAuthenticated && user?.id),
    });
    useEffect(() => {
        isTrayOpenRef.current = isTrayOpen;
    }, [isTrayOpen]);

    useEffect(() => {
        browserDeliveryEnabledRef.current = Boolean(preferencesQuery.data?.delivery?.browser);
    }, [preferencesQuery.data]);

    const notificationsQueryKey = useMemo(() => queryKeys.notifications.page(limit), [limit]);
    const unreadCountQueryKey = useMemo(() => queryKeys.notifications.unreadCount(), []);
    const getCurrentSearch = useCallback(() => {
        return typeof window === "undefined" ? "" : window.location.search;
    }, []);

    const adjustUnreadCounts = useCallback((delta: { total: number; important: number }) => {
        queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, (current = ZERO_COUNTS) => ({
            total: Math.max(0, current.total + delta.total),
            important: Math.max(0, current.important + delta.important),
        }));
    }, [queryClient, unreadCountQueryKey]);

    const patchNotificationCache = useCallback((
        updater: (existing: InfiniteData<NotificationFeedPage> | undefined) =>
            InfiniteData<NotificationFeedPage> | undefined,
    ) => {
        queryClient.setQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey, (existing) => {
            // The loaded feed can be only one page, while the bell counter is a
            // global value. Mutations adjust that counter explicitly; deriving
            // from this partial cache would both under-count and double-apply.
            return updater(existing);
        });
    }, [notificationsQueryKey, queryClient]);

    const unreadCountQuery = useQuery<UnreadCounts>({
        queryKey: unreadCountQueryKey,
        enabled: Boolean(isAuthenticated && user?.id),
        queryFn: async () => {
            const result = await readNotificationUnreadCountAction();
            if (!result.success) {
                throw new Error(result.error || "Failed to load notification count");
            }
            return { total: result.unreadCount, important: result.unreadImportantCount };
        },
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });

    const query = useInfiniteQuery({
        queryKey: notificationsQueryKey,
        enabled: Boolean(isAuthenticated && user?.id && isTrayOpen),
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const result = await readNotificationsAction(limit, pageParam);
            if (!result.success || !result.page) {
                throw new Error(result.error || "Failed to fetch notifications");
            }
            queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, {
                total: result.page.unreadCount,
                important: result.page.unreadImportantCount,
            });
            return result.page satisfies NotificationFeedPage;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });

    const openItem = useCallback(async (
        item: NotificationItem,
        source: "notification_bell" | "notification_toast" = "notification_bell",
    ) => {
        const href = buildNotificationHref(item);
        if (!item.readAt) {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const previousUnreadCounts = queryClient.getQueryData<UnreadCounts>(unreadCountQueryKey);
            const readAt = new Date().toISOString();
            patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, {
                ...item,
                readAt,
                seenAt: item.seenAt ?? readAt,
            }));
            if (!item.seenAt) {
                adjustUnreadCounts({ total: -1, important: item.importance === "important" ? -1 : 0 });
            }
            try {
                const result = await markNotificationReadAction(item.id);
                if (!result.success || !result.item) {
                    throw new Error(result.error || "Failed to mark notification read");
                }
                patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, result.item!));
            } catch (error) {
                if (previous) {
                    queryClient.setQueryData(notificationsQueryKey, previous);
                }
                if (previousUnreadCounts) {
                    queryClient.setQueryData(unreadCountQueryKey, previousUnreadCounts);
                } else {
                    void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
                }
                toast.error(error instanceof Error ? error.message : "Failed to mark notification read");
            }
        }
        if (!href) return false;
        if (href.startsWith("/messages")) {
            recordMessagesOpen({
                source,
                surface: "notification",
                hasMessageTarget: href.includes("messageId="),
            });
        }
        router.push(href);
        viewedNotificationIdsRef.current.clear();
        isTrayOpenRef.current = false;
        setIsTrayOpen(false);
        return true;
    }, [
        adjustUnreadCounts,
        notificationsQueryKey,
        patchNotificationCache,
        queryClient,
        router,
        unreadCountQueryKey,
    ]);

    const flushToastQueue = useCallback(() => {
        const queued = toastQueueRef.current;
        toastQueueRef.current = [];
        toastTimerRef.current = null;
        if (queued.length === 0) return;
        const first = queued[0]!;
        const context = first.preview?.contextLabel ?? first.preview?.secondaryText ?? "your workspace";
        const title = queued.length === 1
            ? first.title
            : `${queued.length} new updates in ${context}`;
        toast(title, {
            description: queued.length === 1 ? first.body ?? undefined : "Open the bell to review the grouped updates.",
            action: first.href
                ? {
                    label: "Open",
                    onClick: () => void openItem(first, "notification_toast"),
                }
                : undefined,
        });
    }, [openItem]);

    const queueImportantToast = useCallback((item: NotificationItem) => {
        if (shouldSuppressNotificationToast({
            item,
            pathname,
            search: getCurrentSearch(),
            trayOpen: isTrayOpen,
            activeConversationId: activePopupConversationId,
            documentVisible: typeof document === "undefined" ? true : document.visibilityState === "visible",
        })) {
            return;
        }
        toastQueueRef.current.push(item);
        // Idle users get a single flush on return, not a cascade of toasts mid-AFK.
        if (isIdleRef.current) return;
        if (toastTimerRef.current) return;
        toastTimerRef.current = setTimeout(flushToastQueue, TOAST_BATCH_MS);
    }, [flushToastQueue, getCurrentSearch, isTrayOpen, pathname]);

    useEffect(() => {
        queueImportantToastRef.current = queueImportantToast;
    }, [queueImportantToast]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const resumeFromIdle = () => {
            if (!isIdleRef.current) return;
            isIdleRef.current = false;
            setIsIdle(false);
            // Debounce so toggling tabs or jiggling the mouse doesn't fire
            // a half-built toast batch.
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = setTimeout(() => {
                if (toastQueueRef.current.length > 0) {
                    flushToastQueue();
                }
                flushTimer = null;
            }, IDLE_FLUSH_DEBOUNCE_MS);
        };

        const resetIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            resumeFromIdle();
            idleTimer = setTimeout(() => {
                isIdleRef.current = true;
                setIsIdle(true);
            }, IDLE_THRESHOLD_MS);
        };

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                resetIdleTimer();
            }
        };

        const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "focus"] as const;
        for (const name of events) {
            window.addEventListener(name, resetIdleTimer, { passive: true });
        }
        document.addEventListener("visibilitychange", handleVisibility);
        resetIdleTimer();

        return () => {
            if (idleTimer) clearTimeout(idleTimer);
            if (flushTimer) clearTimeout(flushTimer);
            for (const name of events) {
                window.removeEventListener(name, resetIdleTimer);
            }
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [flushToastQueue]);

    useEffect(() => {
        if (!isConnected) return;
        void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
        if (isTrayOpenRef.current) {
            void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
        }
    }, [isConnected, notificationsQueryKey, queryClient, unreadCountQueryKey]);

    // Authentication hydration and a cold Realtime tenant are normal startup
    // states. Only a terminal channel status should be presented as a failure.
    const isRealtimeHealthy = notificationStatus !== 'disconnected';

    useEffect(() => {
        if (!user?.id || !isAuthenticated) return;
        return subscribeUserNotifications((event) => {
                if (event.kind !== "notification") return;
                const newItem = normalizeRealtimeNotificationRow(event.payload.eventType === "DELETE" ? null : event.payload.new);
                const oldItem = normalizeRealtimeNotificationRow(event.payload.old);
                if (event.payload.eventType === "DELETE") {
                    if (oldItem) {
                        patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, oldItem.id));
                        if (isUnreadVisible(oldItem)) {
                            adjustUnreadCounts({
                                total: -1,
                                important: oldItem.importance === "important" ? -1 : 0,
                            });
                        }
                    }
                    return;
                }
                if (!newItem) return;

                if (isActivelySnoozed(newItem)) {
                    patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, newItem.id));
                    if (isUnreadVisible(oldItem) && !isActivelySnoozed(oldItem)) {
                        adjustUnreadCounts({
                            total: -1,
                            important: oldItem?.importance === "important" ? -1 : 0,
                        });
                    }
                    return;
                }

                patchNotificationCache((existing) => upsertNotificationInInfiniteData(existing, newItem));
                const newVisible = isUnreadVisible(newItem);
                const oldVisible = isUnreadVisible(oldItem) && !isActivelySnoozed(oldItem);
                const delta = Number(newVisible) - Number(oldVisible);
                if (delta !== 0) {
                    const newImportant = newVisible && newItem.importance === "important" ? 1 : 0;
                    const oldImportant = oldVisible && oldItem?.importance === "important" ? 1 : 0;
                    adjustUnreadCounts({ total: delta, important: newImportant - oldImportant });
                }
                const isFreshInsert = event.payload.eventType === "INSERT" || (event.payload.eventType === "UPDATE" && !oldItem?.activityAt);
                const isNewActivity = event.payload.eventType === "UPDATE" && oldItem?.activityAt !== newItem.activityAt && !newItem.seenAt;
                if (isFreshInsert || isNewActivity) {
                    queueImportantToastRef.current(newItem);
                    if (browserDeliveryEnabledRef.current) {
                        showBrowserNotification({
                            item: newItem,
                            enabled: true,
                            tabVisible: typeof document === "undefined" ? true : document.visibilityState === "visible",
                            onClickHref: (href) => {
                                void markNotificationReadAction(newItem.id).finally(() => {
                                    try {
                                        router.push(href);
                                    } catch {
                                        // router not ready — skip
                                    }
                                });
                            },
                        });
                    }
                }
                if (isTrayOpenRef.current) {
                    // Re-fetch once so the feed can resolve the actor profile rather
                    // than relying on an incomplete realtime preview snapshot.
                    void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
                }
            });
    }, [
        isAuthenticated,
        adjustUnreadCounts,
        notificationsQueryKey,
        patchNotificationCache,
        router,
        subscribeUserNotifications,
        user?.id,
    ]);



    useEffect(() => {
        return () => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    const markVisibleSeenMutation = useMutation({
        mutationFn: async (notificationIds: string[]) => {
            const result = await markNotificationsSeenAction(notificationIds);
            if (!result.success) {
                throw new Error(result.error || "Failed to mark notifications seen");
            }
            return result;
        },
        onMutate: async (notificationIds) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const current = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const seenAt = new Date().toISOString();
            const targets = current?.pages
                .flatMap((page) => page.items)
                .filter((item) => notificationIds.includes(item.id) && !item.seenAt) ?? [];
            if (targets.length > 0) {
                patchNotificationCache((existing) => markNotificationsSeenInInfiniteData(existing, targets.map((item) => item.id), seenAt));
                adjustUnreadCounts({
                    total: -targets.length,
                    important: -targets.filter((item) => item.importance === "important").length,
                });
            }
            return { targetIds: targets.map((item) => item.id) };
        },
        onError: (error) => {
            // Do not restore an old snapshot: another visible batch may have
            // succeeded meanwhile. The authoritative refetch repairs the cache.
            void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(error instanceof Error ? error.message : "Failed to update notification state");
        },
        onSuccess: (result) => {
            for (const item of result.items) {
                patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, item));
            }
        },
    });

    const markUnreadMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const result = await markNotificationUnreadAction(notificationId);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Failed to mark notification unread");
            }
            return result.item;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => {
                if (!target) return existing;
                return patchNotificationReadStateInInfiniteData(existing, {
                    ...target,
                    readAt: null,
                    seenAt: null,
                });
            });
            if (target?.seenAt) {
                adjustUnreadCounts({ total: 1, important: target.importance === "important" ? 1 : 0 });
            }
            return { previous, target };
        },
        onError: (error, _notificationId, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(error instanceof Error ? error.message : "Failed to mark notification unread");
        },
        onSuccess: (item) => {
            patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, item));
        },
    });

    const dismissMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const result = await dismissNotificationAction(notificationId);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Failed to dismiss notification");
            }
            return result.item;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, notificationId));
            if (target && !target.seenAt) {
                adjustUnreadCounts({ total: -1, important: target.importance === "important" ? -1 : 0 });
            }
            return { previous };
        },
        onError: (error, _notificationId, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(error instanceof Error ? error.message : "Failed to dismiss notification");
        },
    });

    const muteMutation = useMutation({
        mutationFn: async (scope: NotificationMuteScope) => {
            const result = await muteNotificationScopeAction(scope);
            if (!result.success) throw new Error(result.error || "Failed to turn off notifications");
            return result.preferences;
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Failed to turn off notifications");
        },
    });

    const snoozeMutation = useMutation({
        mutationFn: async ({ notificationId, snoozedUntil }: { notificationId: string; snoozedUntil: string }) => {
            const result = await snoozeNotificationAction(notificationId, snoozedUntil);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Failed to snooze notification");
            }
            return result.item;
        },
        onMutate: async ({ notificationId }) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, notificationId));
            if (target && !target.seenAt) {
                adjustUnreadCounts({ total: -1, important: target.importance === "important" ? -1 : 0 });
            }
            return { previous };
        },
        onError: (error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(error instanceof Error ? error.message : "Failed to snooze notification");
        },
        onSuccess: () => {
            toast.success("Snoozed — we'll bring it back");
        },
    });

    const items = useMemo(
        () => query.data?.pages.flatMap((page) => page.items).filter((item) => !item.dismissedAt) ?? [],
        [query.data?.pages],
    );
    const unreadCounts = unreadCountQuery.data ?? deriveUnreadCounts(query.data);
    const unreadCount = unreadCounts.total;
    const unreadImportantCount = unreadCounts.important;
    const loadMore = useCallback(() => query.fetchNextPage(), [query]);
    const refresh = useCallback(() => query.refetch(), [query]);
    const commitViewedNotifications = useCallback((notificationIds: string[]) => {
        const ids = Array.from(new Set(notificationIds.filter(Boolean)));
        if (ids.length === 0) return;
        void (async () => {
            for (let index = 0; index < ids.length; index += QUALIFIED_VIEW_BATCH_SIZE) {
                try {
                    await markVisibleSeenMutation.mutateAsync(ids.slice(index, index + QUALIFIED_VIEW_BATCH_SIZE));
                } catch {
                    // The mutation already restores/revalidates and shows the
                    // actionable failure. Continue so one failed batch cannot
                    // strand later, independently reviewed notifications.
                }
            }
        })();
    }, [markVisibleSeenMutation]);
    const stageViewedNotifications = useCallback((notificationIds: string[]) => {
        if (!isTrayOpenRef.current) return;
        for (const notificationId of notificationIds) {
            if (notificationId) viewedNotificationIdsRef.current.add(notificationId);
        }
    }, []);
    const setTrayOpen = useCallback((open: boolean) => {
        if (open) {
            viewedNotificationIdsRef.current.clear();
            isTrayOpenRef.current = true;
            setIsTrayOpen(true);
            return;
        }
        const viewedIds = Array.from(viewedNotificationIdsRef.current);
        viewedNotificationIdsRef.current.clear();
        isTrayOpenRef.current = false;
        setIsTrayOpen(false);
        commitViewedNotifications(viewedIds);
    }, [commitViewedNotifications]);
    const openTray = useCallback(() => setTrayOpen(true), [setTrayOpen]);
    const closeTray = useCallback(() => setTrayOpen(false), [setTrayOpen]);
    const markUnread = useCallback((notificationId: string) => markUnreadMutation.mutateAsync(notificationId), [markUnreadMutation]);
    const dismiss = useCallback((notificationId: string) => dismissMutation.mutateAsync(notificationId), [dismissMutation]);
    const muteScope = useCallback((scope: NotificationMuteScope) => muteMutation.mutateAsync(scope), [muteMutation]);
    const muteItemType = useCallback((item: NotificationItem) => muteMutation.mutateAsync(getNarrowestNotificationMuteScope(item)), [muteMutation]);
    const snooze = useCallback((notificationId: string, snoozedUntil: string) =>
        snoozeMutation.mutateAsync({ notificationId, snoozedUntil }), [snoozeMutation]);

    return useMemo(() => ({
        items,
        unreadCount,
        unreadImportantCount,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isRealtimeHealthy,
        isIdle,
        hasMore: Boolean(query.hasNextPage),
        isLoadingMore: query.isFetchingNextPage,
        activeFilter,
        setActiveFilter,
        isTrayOpen,
        openTray,
        closeTray,
        setTrayOpen,
        loadMore,
        refresh,
        stageViewedNotifications,
        markUnread,
        dismiss,
        muteScope,
        muteItemType,
        snooze,
        openItem,
    }), [
        items,
        unreadCount,
        unreadImportantCount,
        query.isLoading,
        query.isFetching,
        isRealtimeHealthy,
        isIdle,
        query.hasNextPage,
        query.isFetchingNextPage,
        activeFilter,
        isTrayOpen,
        openTray,
        closeTray,
        setTrayOpen,
        loadMore,
        refresh,
        stageViewedNotifications,
        markUnread,
        dismiss,
        muteScope,
        muteItemType,
        snooze,
        openItem,
    ]);
}
