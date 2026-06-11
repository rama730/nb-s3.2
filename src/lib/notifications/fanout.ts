import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
    createNotification,
    upsertAggregatedNotification,
    type CreateNotificationInput,
} from "@/lib/notifications/service";
import type {
    NotificationFanoutEvent,
    NotificationFanoutWrite,
} from "@/lib/notifications/types";

type NotificationWriteExecutor = Parameters<typeof createNotification>[1];
const NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE = 100;

function normalizeWrites(writes: NotificationFanoutWrite[]): NotificationFanoutWrite[] {
    return writes.filter((write) => write.input.recipientUserId && write.input.dedupeKey);
}

export type NotificationFanoutDeliveryResult = {
    delivered: number;
    failed: number;
    failedWrites: NotificationFanoutWrite[];
};

export type NotificationFanoutEnqueueResult = {
    enqueued: number;
    delivered?: number;
    failed?: number;
    error?: string;
    mode?: "queued" | "inline-fallback" | "failed";
};

export async function enqueueNotificationFanout(event: NotificationFanoutEvent): Promise<NotificationFanoutEnqueueResult> {
    const writes = normalizeWrites(event.writes);
    if (writes.length === 0) return { enqueued: 0 };

    const payload: NotificationFanoutEvent = {
        ...event,
        writes,
        queuedAt: event.queuedAt ?? new Date().toISOString(),
    };

    try {
        await inngest.send({
            name: "notification/fanout",
            data: payload,
        });
        return { enqueued: writes.length, mode: "queued" };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        try {
            const fallback = await deliverNotificationFanout({
                ...payload,
                source: `${payload.source ?? "notification"}:inline-fallback`,
            }, db);
            if (fallback.failed === 0) {
                logger.info("notifications.fanout_enqueue_inline_fallback", {
                    module: "notifications",
                    source: event.source ?? null,
                    traceId: event.traceId ?? null,
                    count: writes.length,
                    error: errorMessage,
                });
                return {
                    enqueued: 0,
                    delivered: fallback.delivered,
                    failed: 0,
                    mode: "inline-fallback",
                };
            }

            logger.error("notifications.fanout_enqueue_failed", {
                module: "notifications",
                source: event.source ?? null,
                traceId: event.traceId ?? null,
                count: writes.length,
                error: `${errorMessage}; inline fallback failed ${fallback.failed}/${writes.length}`,
            });
            return {
                enqueued: 0,
                delivered: fallback.delivered,
                failed: fallback.failed,
                error: errorMessage,
                mode: "failed",
            };
        } catch (fallbackError) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            logger.error("notifications.fanout_enqueue_failed", {
                module: "notifications",
                source: event.source ?? null,
                traceId: event.traceId ?? null,
                count: writes.length,
                error: `${errorMessage}; inline fallback threw: ${fallbackMessage}`,
            });
            return {
                enqueued: 0,
                failed: writes.length,
                error: errorMessage,
                mode: "failed",
            };
        }
    }
}

export async function deliverNotificationFanout(
    event: NotificationFanoutEvent,
    executor?: NotificationWriteExecutor,
): Promise<NotificationFanoutDeliveryResult> {
    const writes = normalizeWrites(event.writes);
    if (writes.length === 0) return { delivered: 0, failed: 0, failedWrites: [] };

    const results = await Promise.allSettled(writes.map((write) => {
        if (write.operation === "aggregate") {
            return upsertAggregatedNotification(write.input as CreateNotificationInput, executor);
        }
        return createNotification(write.input as CreateNotificationInput, executor);
    }));

    const failed = results
        .map((result, index) => ({ result, write: writes[index] }))
        .filter((entry): entry is { result: PromiseRejectedResult; write: NotificationFanoutWrite } =>
            entry.result.status === "rejected" && Boolean(entry.write),
        );
    if (failed.length > 0) {
        logger.error("notifications.fanout_delivery_failed", {
            module: "notifications",
            source: event.source ?? null,
            traceId: event.traceId ?? null,
            failed: failed.length,
            total: writes.length,
            errors: failed.slice(0, 5).map(({ result }) =>
                result.reason instanceof Error
                    ? result.reason.message
                    : String(result.reason),
            ),
        });
    }

    return {
        delivered: results.length - failed.length,
        failed: failed.length,
        failedWrites: failed.map(({ write }) => write),
    };
}

export async function emitNotificationWrite(
    write: NotificationFanoutWrite,
    executor?: NotificationWriteExecutor,
) {
    if (executor) {
        return deliverNotificationFanout({ writes: [write], source: "inline" }, executor);
    }
    return enqueueNotificationFanout({ writes: [write], source: "source-action" });
}

export async function emitNotificationWrites(
    writes: NotificationFanoutWrite[],
    executor?: NotificationWriteExecutor,
) {
    const normalized = normalizeWrites(writes);
    if (normalized.length === 0) {
        return executor ? { delivered: 0, failed: 0, failedWrites: [] } : { enqueued: 0 };
    }
    if (executor) {
        return deliverNotificationFanout({ writes: normalized, source: "inline" }, executor);
    }
    if (normalized.length <= NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE) {
        return enqueueNotificationFanout({ writes: normalized, source: "source-action" });
    }

    const chunks: NotificationFanoutWrite[][] = [];
    for (let index = 0; index < normalized.length; index += NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE) {
        chunks.push(normalized.slice(index, index + NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE));
    }

    const results = await Promise.all(chunks.map((chunk, index) =>
        enqueueNotificationFanout({
            writes: chunk,
            source: `source-action:batch:${index + 1}/${chunks.length}`,
        }),
    ));

    return {
        enqueued: results.reduce((total, result) => total + result.enqueued, 0),
        error: results.find((result) => result.error)?.error,
    };
}
