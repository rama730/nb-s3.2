import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
    createNotification,
    getNotificationPreferencesMap,
    upsertAggregatedNotification,
    type CreateNotificationInput,
} from "@/lib/notifications/service";
import type {
    NotificationFanoutEvent,
    NotificationFanoutWrite,
} from "@/lib/notifications/types";

type NotificationWriteExecutor = Parameters<typeof createNotification>[1];
const NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE = 100;
const NOTIFICATION_WRITE_CONCURRENCY = 20;

function normalizeWrites(writes: NotificationFanoutWrite[]): NotificationFanoutWrite[] {
    return writes.filter((write) => write.input.recipientUserId && write.input.dedupeKey);
}

/**
 * Event producers may carry an old or incomplete snapshot, especially when an
 * auth provider has not refreshed its metadata. Resolve every distinct actor
 * once per fan-out batch so durable rows, realtime updates, and web push all
 * receive the canonical profile identity without an N+1 query per recipient.
 */
async function hydrateActorPreviews(
    writes: NotificationFanoutWrite[],
    executor?: NotificationWriteExecutor,
): Promise<NotificationFanoutWrite[]> {
    // Message sends already load the current sender profile to build their
    // durable preview. Avoid reading the same profile again on the response
    // path; other notification producers still use the canonical fallback.
    const needsHydration = writes.some((write) => {
        if (!write.input.actorUserId) return false;
        const preview = write.input.preview;
        return !preview?.actorName && !preview?.actorAvatarUrl;
    });
    if (!needsHydration) return writes;

    const actorIds = Array.from(new Set(writes
        .map((write) => write.input.actorUserId)
        .filter((actorId): actorId is string => Boolean(actorId))));
    if (actorIds.length === 0) return writes;

    const tx = executor ?? db;
    const actors = await tx
        .select({ id: profiles.id, fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl })
        .from(profiles)
        .where(inArray(profiles.id, actorIds));
    const actorById = new Map(actors.map((actor) => [actor.id, {
        name: actor.fullName || actor.username || null,
        avatarUrl: actor.avatarUrl ?? null,
    }]));

    return writes.map((write) => {
        const actor = write.input.actorUserId ? actorById.get(write.input.actorUserId) : null;
        if (!actor) return write;
        const preview = write.input.preview ?? null;
        const actorName = actor.name ?? preview?.actorName ?? null;
        const actorAvatarUrl = actor.avatarUrl ?? preview?.actorAvatarUrl ?? null;
        if (!actorName && !actorAvatarUrl) return write;
        return {
            ...write,
            input: {
                ...write.input,
                preview: {
                    ...(preview ?? {}),
                    actorName,
                    actorAvatarUrl,
                },
            },
        };
    });
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
    const normalizedWrites = normalizeWrites(event.writes);
    if (normalizedWrites.length === 0) return { delivered: 0, failed: 0, failedWrites: [] };
    // Profile enrichment must never become a delivery dependency. A stale
    // profile read should fall back to the producer snapshot, not discard a
    // whole notification batch.
    let writes = normalizedWrites;
    try {
        writes = await hydrateActorPreviews(normalizedWrites, executor);
    } catch (error) {
        logger.warn("notifications.actor_preview_hydration_failed", {
            module: "notifications",
            source: event.source ?? null,
            traceId: event.traceId ?? null,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const tx = executor ?? db;
    const preferenceMap = await getNotificationPreferencesMap(
        tx,
        writes.map((write) => write.input.recipientUserId),
    );
    const results: PromiseSettledResult<Awaited<ReturnType<typeof createNotification>>>[] = [];
    for (let index = 0; index < writes.length; index += NOTIFICATION_WRITE_CONCURRENCY) {
        const chunk = writes.slice(index, index + NOTIFICATION_WRITE_CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map((write) => {
            if (write.operation === "aggregate") {
                return upsertAggregatedNotification(
                    write.input as CreateNotificationInput,
                    executor,
                    preferenceMap,
                );
            }
            return createNotification(
                write.input as CreateNotificationInput,
                executor,
                preferenceMap,
            );
        }));
        results.push(...settled);
    }

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
    return emitNotificationWrites([write], executor);
}

export async function emitNotificationWrites(
    writes: NotificationFanoutWrite[],
    executor?: NotificationWriteExecutor,
) {
    const normalized = normalizeWrites(writes);
    if (normalized.length === 0) {
        return executor ? { delivered: 0, failed: 0, failedWrites: [] } : { enqueued: 0 };
    }
    const chunks: NotificationFanoutWrite[][] = [];
    for (let index = 0; index < normalized.length; index += NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE) {
        chunks.push(normalized.slice(index, index + NOTIFICATION_FANOUT_EVENT_CHUNK_SIZE));
    }

    // A notification is part of the visible product state, so persist it in
    // the source request. The worker remains a retry mechanism for a failed
    // subset; it is no longer a prerequisite for local or production delivery.
    const deliveries = await Promise.all(chunks.map((chunk, index) =>
        deliverNotificationFanout({
            writes: chunk,
            source: chunks.length === 1 ? "source-action:inline" : `source-action:inline:${index + 1}/${chunks.length}`,
        }, executor ?? db),
    ));
    const failedWrites = deliveries.flatMap((result) => result.failedWrites);
    if (failedWrites.length === 0) {
        return {
            delivered: deliveries.reduce((total, result) => total + result.delivered, 0),
            failed: 0,
            failedWrites: [],
        };
    }

    const retry = await enqueueNotificationFanout({
        writes: failedWrites,
        source: "source-action:inline-retry",
    });
    return {
        delivered: deliveries.reduce((total, result) => total + result.delivered, 0),
        failed: failedWrites.length,
        failedWrites,
        enqueued: retry.enqueued,
        error: retry.error,
    };
}
