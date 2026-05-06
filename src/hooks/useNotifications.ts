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
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { toast } from "sonner";

import {
    dismissNotificationAction,
    markAllNotificationsReadAction,
    markNotificationReadAction,
    markNotificationUnreadAction,
    muteNotificationScopeAction,
    pauseNotificationsAction,
    readNotificationUnreadCountAction,
    readNotificationsAction,
    snoozeNotificationAction,
} from "@/app/actions/notifications";
import {
    markAllNotificationsReadInInfiniteData,
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
import { isRealtimeTerminalStatus, subscribeNotificationInbox } from "@/lib/realtime/subscriptions";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { useMessagesV2UiStore } from "@/stores/messagesV2UiStore";
import { extractMessageBurstConversationId, type MessageAttentionState } from "@/lib/messages/attention";

const DEFAULT_LIMIT = 20;
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
    if (!id || !userId || !kind || !title || !dedupeKey || !createdAt || !updatedAt) {
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
    return Boolean(item && !item.readAt && !item.dismissedAt);
}

function buildMessageAttentionFromNotification(item: NotificationItem): MessageAttentionState | null {
    const conversationId = extractMessageBurstConversationId(item);
    if (!conversationId || item.readAt || item.dismissedAt) return null;
    return {
        conversationId,
        hasNewMessages: true,
        firstNewMessageId: null,
        latestNewMessageId: null,
        source: "notification",
        clearing: false,
        updatedAt: Date.now(),
    };
}

type UnreadCounts = { total: number; important: number };

const ZERO_COUNTS: UnreadCounts = { total: 0, important: 0 };

function deriveUnreadCounts(data: InfiniteData<NotificationFeedPage> | undefined): UnreadCounts {
    if (!data) return ZERO_COUNTS;
    const head = data.pages[0];
    if (head && (head.unreadCount > 0 || head.unreadImportantCount > 0)) {
        return { total: head.unreadCount, important: head.unreadImportantCount };
    }
    const unread = data.pages.flatMap((page) => page.items).filter((item) => !item.readAt && !item.dismissedAt);
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
    const supabase = useMemo(() => createClient(), []);
    const { user, isAuthenticated } = useAuth();
    const [isTrayOpen, setIsTrayOpen] = useState(false);
    const [activeFilter, setActiveFilter] = useState<NotificationTrayFilter>("unread");
    const [isRealtimeHealthy, setIsRealtimeHealthy] = useState(true);
    const [isIdle, setIsIdle] = useState(false);
    const activePopupConversationId = useMessagesV2UiStore((state) =>
        state.popupOpen && !state.popupMinimized ? state.selectedConversationId : null,
    );
    const openPopupConversationList = useMessagesV2UiStore((state) => state.openPopupConversationList);
    const upsertMessageAttention = useMessagesV2UiStore((state) => state.upsertMessageAttention);
    const clearMessageAttentionSmooth = useMessagesV2UiStore((state) => state.clearMessageAttentionSmooth);
    const isTrayOpenRef = useRef(false);
    const toastQueueRef = useRef<NotificationItem[]>([]);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queueImportantToastRef = useRef<(item: NotificationItem) => void>(() => { });
    const isIdleRef = useRef(false);
    const browserDeliveryEnabledRef = useRef<boolean>(false);
    const preferencesQuery = useNotificationPreferences();
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
            const next = updater(existing);
            if (next) {
                queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, deriveUnreadCounts(next));
            }
            return next;
        });
    }, [notificationsQueryKey, queryClient, unreadCountQueryKey]);

    const invalidateMessageAttentionQueries = useCallback((conversationIds: string[]) => {
        if (conversationIds.length === 0) return;
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages.v2.root() });
    }, [queryClient]);

    const syncMessageAttentionFromNotification = useCallback((item: NotificationItem) => {
        const conversationId = extractMessageBurstConversationId(item);
        if (!conversationId) return;
        const attention = buildMessageAttentionFromNotification(item);
        if (attention) {
            upsertMessageAttention(conversationId, attention);
        } else {
            clearMessageAttentionSmooth(conversationId);
            invalidateMessageAttentionQueries([conversationId]);
        }
    }, [clearMessageAttentionSmooth, invalidateMessageAttentionQueries, upsertMessageAttention]);

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

    const openItem = useCallback(async (item: NotificationItem) => {
        const href = buildNotificationHref(item);
        if (!href) return false;
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
            adjustUnreadCounts({ total: -1, important: item.importance === "important" ? -1 : 0 });
            try {
                const result = await markNotificationReadAction(item.id);
                if (!result.success || !result.item) {
                    throw new Error(result.error || "Failed to mark notification read");
                }
                patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, result.item!));
                const conversationId = extractMessageBurstConversationId(result.item);
                if (conversationId) {
                    clearMessageAttentionSmooth(conversationId);
                    invalidateMessageAttentionQueries([conversationId]);
                }
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
        router.push(href);
        setIsTrayOpen(false);
        return true;
    }, [
        adjustUnreadCounts,
        clearMessageAttentionSmooth,
        invalidateMessageAttentionQueries,
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
        const messageConversationId = extractMessageBurstConversationId(first);
        const isMessageToast = Boolean(messageConversationId && first.kind === "message_burst" && !pathname?.startsWith("/messages"));
        toast(title, {
            description: queued.length === 1 ? first.body ?? undefined : "Open the bell to review the grouped updates.",
            action: isMessageToast && messageConversationId
                ? {
                    label: "Open",
                    onClick: () => {
                        const attention = buildMessageAttentionFromNotification(first);
                        if (attention) upsertMessageAttention(messageConversationId, attention);
                        openPopupConversationList({ highlightConversationId: messageConversationId });
                    },
                }
                : first.href
                ? {
                    label: "Open",
                    onClick: () => void openItem(first),
                }
                : undefined,
        });
    }, [openItem, openPopupConversationList, pathname, upsertMessageAttention]);

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
        const attention = buildMessageAttentionFromNotification(item);
        if (attention) {
            upsertMessageAttention(attention.conversationId, attention);
        }
        toastQueueRef.current.push(item);
        // Idle users get a single flush on return, not a cascade of toasts mid-AFK.
        if (isIdleRef.current) return;
        if (toastTimerRef.current) return;
        toastTimerRef.current = setTimeout(flushToastQueue, TOAST_BATCH_MS);
    }, [activePopupConversationId, flushToastQueue, getCurrentSearch, isTrayOpen, pathname, upsertMessageAttention]);

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
        if (!user?.id || !isAuthenticated) return;
        let disposed = false;
        const channel = subscribeNotificationInbox({
            supabase,
            userId: user.id,
            onEvent: (event) => {
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

                syncMessageAttentionFromNotification(newItem);
                patchNotificationCache((existing) => upsertNotificationInInfiniteData(existing, newItem));
                const newVisible = isUnreadVisible(newItem);
                const oldVisible = isUnreadVisible(oldItem) && !isActivelySnoozed(oldItem);
                const delta = Number(newVisible) - Number(oldVisible);
                if (delta !== 0) {
                    const newImportant = newVisible && newItem.importance === "important" ? 1 : 0;
                    const oldImportant = oldVisible && oldItem?.importance === "important" ? 1 : 0;
                    adjustUnreadCounts({ total: delta, important: newImportant - oldImportant });
                }
                const isFreshInsert = event.payload.eventType === "INSERT" || (event.payload.eventType === "UPDATE" && !oldItem?.updatedAt);
                const isUnreadUpdate = event.payload.eventType === "UPDATE" && oldItem?.updatedAt !== newItem.updatedAt && !oldItem?.readAt;
                if (isFreshInsert || isUnreadUpdate) {
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
            },
            onStatus: (status) => {
                if (disposed) return;
                if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                    setIsRealtimeHealthy(true);
                    void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
                    if (isTrayOpenRef.current) {
                        void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
                    }
                    return;
                }
                if (isRealtimeTerminalStatus(status)) {
                    setIsRealtimeHealthy(false);
                }
            },
        });
        return () => {
            disposed = true;
            channel.unsubscribe();
        };
    }, [
        isAuthenticated,
        adjustUnreadCounts,
        notificationsQueryKey,
        patchNotificationCache,
        queryClient,
        router,
        syncMessageAttentionFromNotification,
        supabase,
        unreadCountQueryKey,
        user?.id,
    ]);

    useEffect(() => {
        if (!user?.id || !isAuthenticated || typeof window === "undefined") return;
        const reconcile = () => {
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            if (isTrayOpen) {
                void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
            }
        };
        const handleVisibility = () => {
            if (document.visibilityState === "visible") reconcile();
        };
        window.addEventListener("focus", reconcile);
        window.addEventListener("online", reconcile);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            window.removeEventListener("focus", reconcile);
            window.removeEventListener("online", reconcile);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [
        isAuthenticated,
        isTrayOpen,
        notificationsQueryKey,
        queryClient,
        unreadCountQueryKey,
        user?.id,
    ]);

    useEffect(() => {
        return () => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    const markReadMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const result = await markNotificationReadAction(notificationId);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Failed to mark notification read");
            }
            return result.item;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const readAt = new Date().toISOString();
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => {
                if (!target) return existing;
                return patchNotificationReadStateInInfiniteData(existing, {
                    ...target,
                    readAt,
                    seenAt: target.seenAt ?? readAt,
                });
            });
            if (target && !target.readAt) {
                adjustUnreadCounts({ total: -1, important: target.importance === "important" ? -1 : 0 });
            }
            return { previous, target };
        },
        onError: (error, _notificationId, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(error instanceof Error ? error.message : "Failed to mark notification read");
        },
        onSuccess: (item) => {
            patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, item));
            const conversationId = extractMessageBurstConversationId(item);
            if (conversationId) {
                clearMessageAttentionSmooth(conversationId);
                invalidateMessageAttentionQueries([conversationId]);
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
                });
            });
            if (target?.readAt) {
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
            if (target && !target.readAt) {
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

    const markAllReadMutation = useMutation({
        mutationFn: async () => {
            const result = await markAllNotificationsReadAction();
            if (!result.success) {
                throw new Error(result.error || "Failed to mark all notifications read");
            }
            return {
                readAt: result.readAt ?? null,
                messageConversationIds: result.messageConversationIds ?? [],
            };
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const readAt = new Date().toISOString();
            const messageConversationIds = Array.from(new Set(
                previous?.pages
                    .flatMap((page) => page.items)
                    .map((item) => extractMessageBurstConversationId(item))
                    .filter((conversationId): conversationId is string => Boolean(conversationId)) ?? [],
            ));
            patchNotificationCache((existing) => markAllNotificationsReadInInfiniteData(existing, readAt));
            queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, ZERO_COUNTS);
            if (messageConversationIds.length > 0) {
                clearMessageAttentionSmooth(messageConversationIds);
                invalidateMessageAttentionQueries(messageConversationIds);
            }
            return { previous, messageConversationIds };
        },
        onError: (error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(error instanceof Error ? error.message : "Failed to mark all notifications read");
        },
        onSuccess: (result) => {
            if (result.readAt) {
                patchNotificationCache((existing) => markAllNotificationsReadInInfiniteData(existing, result.readAt!));
            }
            if (result.messageConversationIds.length > 0) {
                clearMessageAttentionSmooth(result.messageConversationIds);
                invalidateMessageAttentionQueries(result.messageConversationIds);
            }
            queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, ZERO_COUNTS);
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
            if (target && !target.readAt) {
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

    const pauseMutation = useMutation({
        mutationFn: async (pausedUntil: string | null) => {
            const result = await pauseNotificationsAction(pausedUntil);
            if (!result.success) throw new Error(result.error || "Failed to pause notifications");
            return result.preferences;
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Failed to pause notifications");
        },
    });

    const items = useMemo(
        () => query.data?.pages.flatMap((page) => page.items).filter((item) => !item.dismissedAt) ?? [],
        [query.data?.pages],
    );
    const unreadCounts = unreadCountQuery.data ?? deriveUnreadCounts(query.data);
    const unreadCount = unreadCounts.total;
    const unreadImportantCount = unreadCounts.important;
    return {
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
        openTray: () => setIsTrayOpen(true),
        closeTray: () => setIsTrayOpen(false),
        setTrayOpen: setIsTrayOpen,
        loadMore: () => query.fetchNextPage(),
        refresh: () => query.refetch(),
        markRead: (notificationId: string) => markReadMutation.mutateAsync(notificationId),
        markUnread: (notificationId: string) => markUnreadMutation.mutateAsync(notificationId),
        markAllRead: () => markAllReadMutation.mutateAsync(),
        dismiss: (notificationId: string) => dismissMutation.mutateAsync(notificationId),
        muteScope: (scope: NotificationMuteScope) => muteMutation.mutateAsync(scope),
        muteItemType: (item: NotificationItem) => muteMutation.mutateAsync(getNarrowestNotificationMuteScope(item)),
        pause: (pausedUntil: string | null) => pauseMutation.mutateAsync(pausedUntil),
        snooze: (notificationId: string, snoozedUntil: string) =>
            snoozeMutation.mutateAsync({ notificationId, snoozedUntil }),
        openItem,
    };
}
