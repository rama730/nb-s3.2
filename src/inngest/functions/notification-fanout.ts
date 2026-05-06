import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { userNotifications } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { deliverNotificationFanout } from "@/lib/notifications/fanout";
import type { NotificationFanoutEvent, NotificationFanoutWrite } from "@/lib/notifications/types";

const MAX_FANOUT_REQUEUE_ATTEMPTS = 3;

type RequeuedNotificationFanoutEvent = {
    name: "notification/fanout";
    data: NotificationFanoutEvent;
};

function buildRetryEvent(
    eventData: NotificationFanoutEvent,
    failedWrites: NotificationFanoutWrite[],
): RequeuedNotificationFanoutEvent | null {
    if (failedWrites.length === 0) return null;
    const retryAttempt = (eventData.retryAttempt ?? 0) + 1;
    if (retryAttempt > MAX_FANOUT_REQUEUE_ATTEMPTS) return null;
    return {
        name: "notification/fanout",
        data: {
            ...eventData,
            writes: failedWrites,
            source: `${eventData.source ?? "notification"}:retry`,
            queuedAt: new Date().toISOString(),
            retryAttempt,
        },
    };
}

export const notificationFanout = inngest.createFunction(
    {
        id: "notification-fanout",
        name: "Notification Fanout",
        batchEvents: {
            maxSize: 100,
            timeout: "2s",
        },
    },
    [{ event: "notification/fanout" }, { event: "notification/burst" }],
    async ({ events, step }) => {
        const results = await step.run("deliver-notifications", async () => {
            const settled = await Promise.allSettled(
                events.map((event) => deliverNotificationFanout(event.data, db)),
            );
            return settled.reduce(
                (acc, result, index) => {
                    const eventData = events[index]?.data;
                    if (result.status === "fulfilled") {
                        acc.delivered += result.value.delivered;
                        acc.failed += result.value.failed;
                        if (eventData && result.value.failedWrites.length > 0) {
                            const retryEvent = buildRetryEvent(eventData, result.value.failedWrites);
                            if (retryEvent) {
                                acc.requeueEvents.push(retryEvent);
                            } else {
                                acc.dropped += result.value.failedWrites.length;
                                logger.error("notifications.fanout_retry_exhausted", {
                                    module: "notifications",
                                    source: eventData.source ?? null,
                                    traceId: eventData.traceId ?? null,
                                    retryAttempt: eventData.retryAttempt ?? 0,
                                    failed: result.value.failedWrites.length,
                                });
                            }
                        }
                    } else {
                        const failedWrites = eventData?.writes ?? [];
                        acc.failed += failedWrites.length || 1;
                        const retryEvent = eventData ? buildRetryEvent(eventData, failedWrites) : null;
                        if (retryEvent) {
                            acc.requeueEvents.push(retryEvent);
                        } else {
                            acc.dropped += failedWrites.length || 1;
                            logger.error("notifications.fanout_event_delivery_failed", {
                                module: "notifications",
                                source: eventData?.source ?? null,
                                traceId: eventData?.traceId ?? null,
                                retryAttempt: eventData?.retryAttempt ?? 0,
                                failed: failedWrites.length || 1,
                                error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                            });
                        }
                    }
                    return acc;
                },
                {
                    delivered: 0,
                    failed: 0,
                    dropped: 0,
                    requeueEvents: [] as RequeuedNotificationFanoutEvent[],
                },
            );
        });

        if (results.requeueEvents.length > 0) {
            await step.sendEvent("requeue-failed-notification-writes", results.requeueEvents);
        }

        return {
            events: events.length,
            delivered: results.delivered,
            failed: results.failed,
            requeued: results.requeueEvents.length,
            dropped: results.dropped,
        };
    },
);

export const notificationDeliveryRefresh = inngest.createFunction(
    {
        id: "notification-delivery-refresh",
        name: "Notification Delivery Refresh",
    },
    { event: "notification/delivery.refresh" },
    async ({ event, step }) => {
        const refreshed = await step.run("refresh-visible-delayed-rows", async () => {
            const now = new Date();
            const rows = await db
                .update(userNotifications)
                .set({
                    snoozedUntil: null,
                    updatedAt: now,
                })
                .where(and(
                    event.data.userId ? eq(userNotifications.userId, event.data.userId) : undefined,
                    isNull(userNotifications.dismissedAt),
                    lte(userNotifications.snoozedUntil, now),
                    sql`${userNotifications.snoozedUntil} IS NOT NULL`,
                ))
                .returning({ id: userNotifications.id });
            return rows.length;
        });

        return {
            refreshed,
            reason: event.data.reason ?? "manual",
        };
    },
);
