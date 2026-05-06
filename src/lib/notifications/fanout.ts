import { inngest } from "@/inngest/client";
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
    error?: string;
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
        return { enqueued: writes.length };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("notifications.fanout_enqueue_failed", {
            module: "notifications",
            source: event.source ?? null,
            traceId: event.traceId ?? null,
            count: writes.length,
            error: errorMessage,
        });
        return { enqueued: 0, error: errorMessage };
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
    return enqueueNotificationFanout({ writes: normalized, source: "source-action" });
}
