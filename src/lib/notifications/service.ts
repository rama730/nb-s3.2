import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, userNotifications } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    isNotificationPauseActive,
    isQuietHoursActive,
    getNotificationPauseUntil,
    getQuietHoursResumeAt,
    normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import {
    getNotificationReason,
    notificationMatchesMuteScope,
} from "@/lib/notifications/presentation";
import { dispatchWebPush } from "@/lib/notifications/web-push";
import type {
    NotificationEntityRefs,
    NotificationFeedPage,
    NotificationFanoutInput,
    NotificationImportance,
    NotificationItem,
    NotificationKind,
    NotificationMuteScope,
    NotificationPreferenceCategory,
    NotificationPreview,
    NotificationPreferences,
} from "@/lib/notifications/types";

type NotificationWriteExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type NotificationCursor = {
    updatedAt: string;
    id: string;
};

export type CreateNotificationInput = NotificationFanoutInput;

export type NotificationMuteInput = NotificationMuteScope;

function getExecutor(executor?: NotificationWriteExecutor): NotificationWriteExecutor {
    return executor ?? db;
}

function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const next = value instanceof Date ? value : new Date(value);
    return Number.isNaN(next.getTime()) ? null : next;
}

function toIsoString(value: Date | string | null | undefined) {
    const next = toDate(value);
    return next ? next.toISOString() : null;
}

export function encodeNotificationCursor(cursor: NotificationCursor) {
    return Buffer.from(`${cursor.updatedAt}:::${cursor.id}`, "utf8").toString("base64");
}

export function decodeNotificationCursor(raw: string | null | undefined): NotificationCursor | null {
    if (!raw) return null;
    try {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        const [updatedAt, id] = decoded.split(":::");
        if (!updatedAt || !id) return null;
        const parsed = toIsoString(updatedAt);
        if (!parsed) return null;
        return { updatedAt: parsed, id };
    } catch {
        return null;
    }
}

export function toNotificationItem(
    row: typeof userNotifications.$inferSelect,
): NotificationItem {
    return {
        id: row.id,
        userId: row.userId,
        actorUserId: row.actorUserId ?? null,
        kind: row.kind as NotificationKind,
        importance: row.importance as NotificationImportance,
        title: row.title,
        body: row.body ?? null,
        href: row.href ?? null,
        entityRefs: (row.entityRefs as NotificationEntityRefs | null) ?? null,
        preview: (row.preview as NotificationPreview | null) ?? null,
        reason: getNotificationReason(row.kind as NotificationKind, (row.entityRefs as NotificationEntityRefs | null) ?? null),
        dedupeKey: row.dedupeKey,
        aggregateCount: row.aggregateCount ?? 1,
        readAt: toIsoString(row.readAt),
        seenAt: toIsoString(row.seenAt),
        dismissedAt: toIsoString(row.dismissedAt),
        snoozedUntil: toIsoString(row.snoozedUntil),
        createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
        updatedAt: toIsoString(row.updatedAt) ?? toIsoString(row.createdAt) ?? new Date(0).toISOString(),
    };
}

async function getNotificationPreferencesMap(
    executor: NotificationWriteExecutor,
    userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
    const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (normalizedUserIds.length === 0) return new Map();

    const rows = await executor
        .select({
            userId: profiles.id,
            notificationPreferences: profiles.notificationPreferences,
        })
        .from(profiles)
        .where(inArray(profiles.id, normalizedUserIds));

    const map = new Map<string, NotificationPreferences>();
    for (const row of rows) {
        map.set(row.userId, normalizeNotificationPreferences(row.notificationPreferences));
    }
    for (const userId of normalizedUserIds) {
        if (!map.has(userId)) {
            map.set(userId, { ...DEFAULT_NOTIFICATION_PREFERENCES });
        }
    }
    return map;
}

type NotificationSkipReason = "actor_self" | "category_off" | "muted_scope";
type NotificationDelayReason = "paused" | "quiet_hours";

export function resolveNotificationDeliveryPolicy(params: {
    recipientUserId: string;
    actorUserId?: string | null;
    kind: NotificationKind;
    category: NotificationPreferenceCategory;
    entityRefs?: NotificationEntityRefs | null;
    preferenceMap: Map<string, NotificationPreferences>;
    now?: Date;
}): { allowed: true; delayUntil: Date | null; delayReason: NotificationDelayReason | null } | { allowed: false; reason: NotificationSkipReason } {
    const { recipientUserId, actorUserId, kind, category, entityRefs, preferenceMap } = params;
    const now = params.now ?? new Date();
    if (actorUserId && actorUserId === recipientUserId) return { allowed: false, reason: "actor_self" };
    const preferences = preferenceMap.get(recipientUserId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    if (!preferences[category]) return { allowed: false, reason: "category_off" };
    const muted = preferences.mutedScopes.some((scope) => notificationMatchesMuteScope({
        kind,
        actorUserId,
        entityRefs,
    }, scope));
    if (muted) return { allowed: false, reason: "muted_scope" };

    if (isNotificationPauseActive(preferences, now)) {
        return { allowed: true, delayUntil: getNotificationPauseUntil(preferences, now), delayReason: "paused" };
    }
    if (isQuietHoursActive(preferences, now)) {
        return { allowed: true, delayUntil: getQuietHoursResumeAt(preferences, now), delayReason: "quiet_hours" };
    }

    return { allowed: true, delayUntil: null, delayReason: null };
}

export function shouldDelayNotification(preferences: NotificationPreferences, now: Date = new Date()) {
    return isNotificationPauseActive(preferences, now) || isQuietHoursActive(preferences, now);
}

function logEmission(payload: {
    kind: string;
    category: string;
    importance: string;
    path: "create" | "aggregate";
    outcome: "created" | "skipped" | "dedupe_hit" | "aggregated";
    skipped_reason?: NotificationSkipReason;
    delayed_reason?: NotificationDelayReason;
    has_actor: boolean;
    duration_ms: number;
    aggregate_count?: number;
}) {
    logger.info("notification.emit", {
        module: "notifications",
        kind: payload.kind,
        type: payload.path,
        status: payload.outcome,
        reason: payload.skipped_reason ?? payload.delayed_reason ?? null,
        durationMs: payload.duration_ms,
        count: payload.aggregate_count,
    });
}

function maybeDispatchWebPush(
    row: typeof userNotifications.$inferSelect | undefined,
    preferences: NotificationPreferences,
): void {
    if (!row) return;
    if (row.importance !== "important") return;
    if (!preferences.delivery.push) return;
    void dispatchWebPush(row.userId, toNotificationItem(row)).catch((error) => {
        logger.warn("notifications.web_push_dispatch_failed", {
            module: "notifications",
            userId: row.userId,
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

export async function createNotification(
    input: CreateNotificationInput,
    executor?: NotificationWriteExecutor,
) {
    const start = Date.now();
    const importance = input.importance ?? "more";
    const hasActor = Boolean(input.actorUserId);
    const tx = getExecutor(executor);
    const preferenceMap = await getNotificationPreferencesMap(tx, [input.recipientUserId]);
    const check = resolveNotificationDeliveryPolicy({
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        category: input.category,
        entityRefs: input.entityRefs ?? null,
        preferenceMap,
    });
    if (!check.allowed) {
        logEmission({
            kind: input.kind,
            category: input.category,
            importance,
            path: "create",
            outcome: "skipped",
            skipped_reason: check.reason,
            has_actor: hasActor,
            duration_ms: Date.now() - start,
        });
        return { notification: null, skipped: true as const };
    }

    const now = new Date();
    const inserted = await tx
        .insert(userNotifications)
        .values({
            userId: input.recipientUserId,
            actorUserId: input.actorUserId ?? null,
            kind: input.kind,
            importance,
            title: input.title,
            body: input.body ?? null,
            href: input.href ?? null,
            entityRefs: input.entityRefs ?? null,
            preview: input.preview ?? null,
            dedupeKey: input.dedupeKey,
            aggregateCount: Math.max(1, input.aggregateCount ?? 1),
            readAt: null,
            seenAt: null,
            dismissedAt: null,
            snoozedUntil: check.delayUntil,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoNothing({
            target: [userNotifications.userId, userNotifications.dedupeKey],
        })
        .returning();

    if (inserted[0]) {
        logEmission({
            kind: input.kind,
            category: input.category,
            importance,
            path: "create",
            outcome: "created",
            has_actor: hasActor,
            duration_ms: Date.now() - start,
            aggregate_count: inserted[0].aggregateCount ?? 1,
            delayed_reason: check.delayReason ?? undefined,
        });
        const recipientPrefs = preferenceMap.get(input.recipientUserId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
        if (!check.delayUntil) {
            maybeDispatchWebPush(inserted[0], recipientPrefs);
        }
        return { notification: inserted[0], skipped: false as const };
    }

    const [existing] = await tx
        .select()
        .from(userNotifications)
        .where(
            and(
                eq(userNotifications.userId, input.recipientUserId),
                eq(userNotifications.dedupeKey, input.dedupeKey),
            ),
        )
        .limit(1);

    logEmission({
        kind: input.kind,
        category: input.category,
        importance,
        path: "create",
        outcome: "dedupe_hit",
        has_actor: hasActor,
        duration_ms: Date.now() - start,
        aggregate_count: existing?.aggregateCount ?? undefined,
    });
    return { notification: existing ?? null, skipped: false as const };
}

export async function upsertAggregatedNotification(
    input: CreateNotificationInput,
    executor?: NotificationWriteExecutor,
) {
    const start = Date.now();
    const importance = input.importance ?? "more";
    const hasActor = Boolean(input.actorUserId);
    const tx = getExecutor(executor);
    const preferenceMap = await getNotificationPreferencesMap(tx, [input.recipientUserId]);
    const check = resolveNotificationDeliveryPolicy({
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        category: input.category,
        entityRefs: input.entityRefs ?? null,
        preferenceMap,
    });
    if (!check.allowed) {
        logEmission({
            kind: input.kind,
            category: input.category,
            importance,
            path: "aggregate",
            outcome: "skipped",
            skipped_reason: check.reason,
            has_actor: hasActor,
            duration_ms: Date.now() - start,
        });
        return { notification: null, skipped: true as const };
    }

    const now = new Date();
    const aggregateDelta = Math.max(1, input.aggregateCount ?? 1);
    const [row] = await tx
        .insert(userNotifications)
        .values({
            userId: input.recipientUserId,
            actorUserId: input.actorUserId ?? null,
            kind: input.kind,
            importance: input.importance ?? "more",
            title: input.title,
            body: input.body ?? null,
            href: input.href ?? null,
            entityRefs: input.entityRefs ?? null,
            preview: input.preview ?? null,
            dedupeKey: input.dedupeKey,
            aggregateCount: aggregateDelta,
            readAt: null,
            seenAt: null,
            dismissedAt: null,
            snoozedUntil: check.delayUntil,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: [userNotifications.userId, userNotifications.dedupeKey],
            set: {
                actorUserId: input.actorUserId ?? null,
                kind: input.kind,
                importance: input.importance ?? "more",
                title: input.title,
                body: input.body ?? null,
                href: input.href ?? null,
                entityRefs: input.entityRefs ?? null,
                preview: input.preview ?? null,
                aggregateCount: sql`CASE
                    WHEN ${userNotifications.readAt} IS NULL THEN ${userNotifications.aggregateCount} + ${aggregateDelta}
                    ELSE ${aggregateDelta}
                END`,
                readAt: null,
                seenAt: null,
                dismissedAt: null,
                snoozedUntil: check.delayUntil,
                updatedAt: now,
            },
        })
        .returning();

    logEmission({
        kind: input.kind,
        category: input.category,
        importance,
        path: "aggregate",
        outcome: "aggregated",
        has_actor: hasActor,
        duration_ms: Date.now() - start,
        aggregate_count: row?.aggregateCount ?? aggregateDelta,
        delayed_reason: check.delayReason ?? undefined,
    });
    const recipientPrefs = preferenceMap.get(input.recipientUserId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    if (!check.delayUntil) {
        maybeDispatchWebPush(row, recipientPrefs);
    }
    return { notification: row ?? null, skipped: false as const };
}

export async function markNotificationRead(
    userId: string,
    notificationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const readAt = new Date();
    const readAtIso = readAt.toISOString();
    const [row] = await tx
        .update(userNotifications)
        .set({ readAt, seenAt: sql`COALESCE(${userNotifications.seenAt}, ${readAtIso}::timestamptz)`, updatedAt: readAt })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
        .returning();
    return row ?? null;
}

export async function markNotificationUnread(
    userId: string,
    notificationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const now = new Date();
    const [row] = await tx
        .update(userNotifications)
        .set({ readAt: null, updatedAt: now })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
        .returning();
    return row ?? null;
}

export async function markAllNotificationsRead(
    userId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const readAt = new Date();
    const readAtIso = readAt.toISOString();
    await tx
        .update(userNotifications)
        .set({
            readAt,
            seenAt: sql`COALESCE(${userNotifications.seenAt}, ${readAtIso}::timestamptz)`,
            updatedAt: readAt,
        })
        .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.readAt), isNull(userNotifications.dismissedAt)));
    return readAt;
}

export async function markNotificationsSeen(
    userId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const seenAt = new Date();
    await tx
        .update(userNotifications)
        .set({
            seenAt,
            updatedAt: seenAt,
        })
        .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.seenAt), isNull(userNotifications.dismissedAt)));
    return seenAt;
}

export async function markConversationNotificationsRead(
    userId: string,
    conversationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const readAt = new Date();
    const readAtIso = readAt.toISOString();
    await tx
        .update(userNotifications)
        .set({
            readAt,
            seenAt: sql`COALESCE(${userNotifications.seenAt}, ${readAtIso}::timestamptz)`,
            updatedAt: readAt,
        })
        .where(
            and(
                eq(userNotifications.userId, userId),
                eq(userNotifications.dedupeKey, `message-burst:${conversationId}`),
                isNull(userNotifications.readAt),
                isNull(userNotifications.dismissedAt),
            ),
        );
    return readAt;
}

export async function countUnreadNotifications(
    userId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const now = new Date();
    const [row] = await tx
        .select({
            total: sql<number>`COUNT(*)::int`,
            important: sql<number>`COUNT(*) FILTER (WHERE ${userNotifications.importance} = 'important')::int`,
        })
        .from(userNotifications)
        .where(and(
            eq(userNotifications.userId, userId),
            isNull(userNotifications.readAt),
            isNull(userNotifications.dismissedAt),
            or(isNull(userNotifications.snoozedUntil), lte(userNotifications.snoozedUntil, now)),
        ));
    return {
        total: row?.total ?? 0,
        important: row?.important ?? 0,
    };
}

export async function snoozeNotification(
    userId: string,
    notificationId: string,
    snoozedUntil: Date,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const now = new Date();
    const [row] = await tx
        .update(userNotifications)
        .set({
            snoozedUntil,
            readAt: null,
            seenAt: null,
            updatedAt: now,
        })
        .where(and(
            eq(userNotifications.userId, userId),
            eq(userNotifications.id, notificationId),
            isNull(userNotifications.dismissedAt),
        ))
        .returning();
    return row ?? null;
}

export async function dismissNotification(
    userId: string,
    notificationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const dismissedAt = new Date();
    const dismissedAtIso = dismissedAt.toISOString();
    const [row] = await tx
        .update(userNotifications)
        .set({
            dismissedAt,
            readAt: sql`COALESCE(${userNotifications.readAt}, ${dismissedAtIso}::timestamptz)`,
            seenAt: sql`COALESCE(${userNotifications.seenAt}, ${dismissedAtIso}::timestamptz)`,
            updatedAt: dismissedAt,
        })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
        .returning();
    return row ?? null;
}

export async function pauseNotifications(
    userId: string,
    pausedUntil: string | null,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const preferenceMap = await getNotificationPreferencesMap(tx, [userId]);
    const current = preferenceMap.get(userId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const normalized = normalizeNotificationPreferences({
        ...current,
        pausedUntil,
    });
    const [row] = await tx
        .update(profiles)
        .set({ notificationPreferences: normalized, updatedAt: new Date() })
        .where(eq(profiles.id, userId))
        .returning({ notificationPreferences: profiles.notificationPreferences });
    return normalizeNotificationPreferences(row?.notificationPreferences ?? normalized);
}

export async function muteNotificationScope(
    userId: string,
    scope: NotificationMuteInput,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const preferenceMap = await getNotificationPreferencesMap(tx, [userId]);
    const current = preferenceMap.get(userId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const mutedAt = new Date().toISOString();
    const nextScope: NotificationMuteScope = {
        kind: scope.kind,
        value: scope.value,
        label: scope.label ?? null,
        mutedAt,
    };
    const existing = current.mutedScopes.filter((entry) => !(entry.kind === nextScope.kind && entry.value === nextScope.value));
    const normalized = normalizeNotificationPreferences({
        ...current,
        mutedScopes: [nextScope, ...existing].slice(0, 100),
    });
    const [row] = await tx
        .update(profiles)
        .set({ notificationPreferences: normalized, updatedAt: new Date() })
        .where(eq(profiles.id, userId))
        .returning({ notificationPreferences: profiles.notificationPreferences });
    return normalizeNotificationPreferences(row?.notificationPreferences ?? normalized);
}

export async function readNotificationsPage(
    userId: string,
    limit: number,
    cursor?: string | null,
    executor?: NotificationWriteExecutor,
): Promise<NotificationFeedPage> {
    const tx = getExecutor(executor);
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const parsedCursor = decodeNotificationCursor(cursor);
    const cursorDate = parsedCursor ? new Date(parsedCursor.updatedAt) : null;

    const now = new Date();
    const rows = await tx
        .select()
        .from(userNotifications)
        .where(
            and(
                eq(userNotifications.userId, userId),
                isNull(userNotifications.dismissedAt),
                or(isNull(userNotifications.snoozedUntil), lte(userNotifications.snoozedUntil, now)),
                parsedCursor && cursorDate
                    ? or(
                        lt(userNotifications.updatedAt, cursorDate),
                        and(eq(userNotifications.updatedAt, cursorDate), lt(userNotifications.id, parsedCursor.id)),
                    )
                    : undefined,
            ),
        )
        .orderBy(desc(userNotifications.updatedAt), desc(userNotifications.id))
        .limit(safeLimit + 1);

    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;
    const counts = await countUnreadNotifications(userId, tx);
    const last = slice[slice.length - 1];

    return {
        items: slice.map(toNotificationItem),
        hasMore,
        nextCursor: hasMore && last
            ? encodeNotificationCursor({
                updatedAt: toIsoString(last.updatedAt) ?? toIsoString(last.createdAt) ?? new Date().toISOString(),
                id: last.id,
            })
            : null,
        unreadCount: counts.total,
        unreadImportantCount: counts.important,
    };
}
