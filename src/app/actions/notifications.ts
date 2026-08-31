"use server";

import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { isTransientDbError, readDbErrorCode, withDbRetry } from "@/lib/db/retry";
import { profiles } from "@/lib/db/schema";
import {
    countUnreadNotifications,
    dismissNotification,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationsSeen,
    markNotificationUnread,
    muteNotificationScope,
    markConversationNotificationsRead,
    pauseNotifications,
    readNotificationsPage,
    snoozeNotification,
    toNotificationItem,
} from "@/lib/notifications/service";
import { InvalidNotificationCursorError } from "@/lib/notifications/cursor";
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import type { NotificationMuteScope, NotificationPreferences } from "@/lib/notifications/types";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

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
            ...(error instanceof InvalidNotificationCursorError ? { code: "INVALID_CURSOR" as const } : {}),
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
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error: any) {
        logger.error("notifications.mark_read_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to mark notification read", item: null };
    }
}

/** Commits rows reviewed during a tray session without consuming their linked content. */
export async function markNotificationsSeenAction(notificationIds: string[]) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", items: [] as ReturnType<typeof toNotificationItem>[] };
        }

        const rows = await markNotificationsSeen(user.id, notificationIds, db);
        const items = rows.map((row) => toNotificationItem(row));
        logger.info("notifications.tray_seen_committed", {
            module: "notifications",
            count: items.length,
            requested: Array.from(new Set(notificationIds.filter(Boolean))).length,
        });
        return { success: true as const, items };
    } catch (error: any) {
        logger.error("notifications.mark_seen_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return {
            success: false as const,
            error: error?.message || "Failed to mark notifications seen",
            items: [] as ReturnType<typeof toNotificationItem>[],
        };
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

        const readAt = await markAllNotificationsRead(user.id, db);
        return {
            success: true as const,
            readAt: readAt?.toISOString() ?? null,
            messageConversationIds: [] as string[],
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

        await markConversationNotificationsRead(user.id, conversationId, db);
        return { success: true as const };
    } catch (error: any) {
        logger.error("notifications.mark_message_burst_conversation_read_failed", {
            module: "notifications",
            conversationId,
            error: error?.message || String(error),
        });
        return { success: false as const, error: "Failed to mark message notifications read" };
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

export async function readNotificationPreferencesAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: DEFAULT_NOTIFICATION_PREFERENCES };
        }

        const [row] = await withDbRetry("notifications.preferences.read", async () => {
            return db
                .select({ notificationPreferences: profiles.notificationPreferences })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1);
        }, { module: "notifications" });

        return {
            success: true as const,
            preferences: normalizeNotificationPreferences(row?.notificationPreferences),
        };
    } catch (error: any) {
        if (isTransientDbError(error)) {
            logger.warn("notifications.preferences_read_transient_fallback", {
                module: "notifications",
                errorCode: readDbErrorCode(error),
                error: error?.message || String(error),
            });
            return {
                success: true as const,
                preferences: DEFAULT_NOTIFICATION_PREFERENCES,
            };
        }

        logger.error("notifications.preferences_read_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return {
            success: false as const,
            error: error?.message || "Failed to read notification preferences",
            preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        };
    }
}

export async function updateNotificationPreferencesAction(preferences: NotificationPreferences) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: null };
        }

        const normalized = normalizeNotificationPreferences(preferences);
        const [row] = await db
            .update(profiles)
            .set({ notificationPreferences: normalized, updatedAt: new Date() })
            .where(eq(profiles.id, user.id))
            .returning({ notificationPreferences: profiles.notificationPreferences });

        if (!row) {
            return { success: false as const, error: "Profile not found", preferences: null };
        }

        return { success: true as const, preferences: normalizeNotificationPreferences(row.notificationPreferences) };
    } catch (error: any) {
        logger.error("notifications.preferences_update_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: error?.message || "Failed to update notification preferences", preferences: null };
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
