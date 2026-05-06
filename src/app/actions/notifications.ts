"use server";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { userNotifications } from "@/lib/db/schema";
import {
    countUnreadNotifications,
    dismissNotification,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationUnread,
    markNotificationsSeen,
    muteNotificationScope,
    pauseNotifications,
    readNotificationsPage,
    snoozeNotification,
    toNotificationItem,
} from "@/lib/notifications/service";
import type { NotificationMuteScope } from "@/lib/notifications/types";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

function extractConversationIdFromEntityRefs(entityRefs: unknown): string | null {
    if (!entityRefs || typeof entityRefs !== "object") return null;
    const conversationId = (entityRefs as { conversationId?: unknown }).conversationId;
    return typeof conversationId === "string" && conversationId.length > 0 ? conversationId : null;
}

async function collectUnreadMessageBurstConversationIds(userId: string) {
    const rows = await db
        .select({ entityRefs: userNotifications.entityRefs })
        .from(userNotifications)
        .where(and(
            eq(userNotifications.userId, userId),
            eq(userNotifications.kind, "message_burst"),
            isNull(userNotifications.readAt),
            isNull(userNotifications.dismissedAt),
        ));

    return Array.from(new Set(
        rows
            .map((row) => extractConversationIdFromEntityRefs(row.entityRefs))
            .filter((conversationId): conversationId is string => Boolean(conversationId)),
    ));
}

async function markMessageBurstConversationsRead(conversationIds: string[]) {
    const uniqueIds = Array.from(new Set(conversationIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    try {
        const { markConversationAsRead } = await import("@/app/actions/messaging/_all");
        const results = await Promise.allSettled(
            uniqueIds.map((conversationId) => markConversationAsRead(conversationId)),
        );
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length > 0) {
            logger.warn("notifications.message_burst_read_sync_partial_failed", {
                module: "notifications",
                conversationIds: uniqueIds,
                failed: failed.length,
            });
        }
    } catch (error: any) {
        logger.warn("notifications.message_burst_read_sync_failed", {
            module: "notifications",
            conversationIds: uniqueIds,
            error: error?.message || String(error),
        });
    }
}

export async function readNotificationsAction(limit = 20, cursor?: string | null) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", page: null };
        }

        const page = await readNotificationsPage(user.id, limit, cursor ?? null, db);
        return { success: true as const, page };
    } catch (error: any) {
        logger.error("notifications.read_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return {
            success: false as const,
            error: error?.message || "Failed to load notifications",
            page: null,
        };
    }
}

export async function readNotificationUnreadCountAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", unreadCount: 0, unreadImportantCount: 0 };
        }

        const counts = await countUnreadNotifications(user.id, db);
        return {
            success: true as const,
            unreadCount: counts.total,
            unreadImportantCount: counts.important,
        };
    } catch (error: any) {
        logger.error("notifications.count_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return {
            success: false as const,
            error: error?.message || "Failed to load notification count",
            unreadCount: 0,
            unreadImportantCount: 0,
        };
    }
}

export async function markNotificationReadAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const row = await markNotificationRead(user.id, notificationId, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        if (row.kind === "message_burst") {
            const conversationId = extractConversationIdFromEntityRefs(row.entityRefs);
            if (conversationId) {
                await markMessageBurstConversationsRead([conversationId]);
            }
        }
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error: any) {
        logger.error("notifications.mark_read_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to mark notification read", item: null };
    }
}

export async function markNotificationUnreadAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const row = await markNotificationUnread(user.id, notificationId, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error: any) {
        logger.error("notifications.mark_unread_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to mark notification unread", item: null };
    }
}

export async function markAllNotificationsReadAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", readAt: null, messageConversationIds: [] as string[] };
        }

        const messageConversationIds = await collectUnreadMessageBurstConversationIds(user.id);
        const readAt = await markAllNotificationsRead(user.id, db);
        await markMessageBurstConversationsRead(messageConversationIds);
        return {
            success: true as const,
            readAt: readAt?.toISOString() ?? null,
            messageConversationIds,
        };
    } catch (error: any) {
        logger.error("notifications.mark_all_read_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return {
            success: false as const,
            error: error?.message || "Failed to mark all notifications read",
            readAt: null,
            messageConversationIds: [] as string[],
        };
    }
}

export async function markConversationMessageNotificationsReadAction(conversationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized" };
        }

        await markMessageBurstConversationsRead([conversationId]);
        return { success: true as const };
    } catch (error: any) {
        logger.error("notifications.mark_message_burst_conversation_read_failed", {
            module: "notifications",
            conversationId,
            error: error?.message || String(error),
        });
        return { success: false as const, error: "Failed to sync message notifications" };
    }
}

export async function markNotificationsSeenAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", seenAt: null };
        }

        const seenAt = await markNotificationsSeen(user.id, db);
        return { success: true as const, seenAt: seenAt?.toISOString() ?? null };
    } catch (error: any) {
        logger.error("notifications.mark_seen_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to mark notifications seen", seenAt: null };
    }
}

export async function dismissNotificationAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const row = await dismissNotification(user.id, notificationId, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error: any) {
        logger.error("notifications.dismiss_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to dismiss notification", item: null };
    }
}

export async function muteNotificationScopeAction(scope: NotificationMuteScope) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: null };
        }

        const preferences = await muteNotificationScope(user.id, scope, db);
        return { success: true as const, preferences };
    } catch (error: any) {
        logger.error("notifications.mute_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to mute notification type", preferences: null };
    }
}

export async function pauseNotificationsAction(pausedUntil: string | null) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: null };
        }

        if (pausedUntil !== null) {
            const until = new Date(pausedUntil);
            if (Number.isNaN(until.getTime())) {
                return { success: false as const, error: "Invalid date", preferences: null };
            }
        }

        const preferences = await pauseNotifications(user.id, pausedUntil, db);
        return { success: true as const, preferences };
    } catch (error: any) {
        logger.error("notifications.pause_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to update notification pause", preferences: null };
    }
}

export async function snoozeNotificationAction(notificationId: string, snoozedUntil: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const until = new Date(snoozedUntil);
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
            return { success: false as const, error: "Snooze time must be in the future", item: null };
        }

        const row = await snoozeNotification(user.id, notificationId, until, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error: any) {
        logger.error("notifications.snooze_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to snooze notification", item: null };
    }
}

export async function readNotificationAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const [row] = await db
            .select()
            .from(userNotifications)
            .where(and(eq(userNotifications.userId, user.id), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
            .limit(1);

        return { success: true as const, item: row ? toNotificationItem(row) : null };
    } catch (error: any) {
        logger.error("notifications.read_one_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to read notification", item: null };
    }
}
