import { and, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobHeartbeats, pushSubscriptions, userNotifications } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

import { inngest } from "../client";

export const RETENTION_JOB_ID = "notifications-retention";

const DISMISSED_TTL_DAYS = 30;
const READ_TTL_DAYS = 90;
const STALE_PUSH_TTL_DAYS = 60;
const MAX_FAILURE_COUNT = 5;
const BATCH_SIZE = 5000;

/**
 * Nightly retention sweep for the notification inbox.
 *
 * - Hard-deletes dismissed rows older than 30 days.
 * - Hard-deletes read rows older than 90 days (user already processed them).
 * - Prunes push subscriptions that have not checked in for 60 days or have
 *   accumulated repeated delivery failures.
 *
 * Unread rows are retained indefinitely so nothing important is lost.
 */
export const notificationsRetention = inngest.createFunction(
    { id: "notifications-retention", retries: 1 },
    { cron: "0 3 * * *" },
    async ({ step }) => {
        const now = new Date();
        const dismissedCutoff = new Date(now.getTime() - DISMISSED_TTL_DAYS * 24 * 60 * 60 * 1000);
        const readCutoff = new Date(now.getTime() - READ_TTL_DAYS * 24 * 60 * 60 * 1000);
        const stalePushCutoff = new Date(now.getTime() - STALE_PUSH_TTL_DAYS * 24 * 60 * 60 * 1000);

        const dismissedDeleted = await step.run("purge-dismissed", async () => {
            let totalDeleted = 0;
            while (true) {
                const victims = await db
                    .select({ id: userNotifications.id })
                    .from(userNotifications)
                    .where(and(
                        isNotNull(userNotifications.dismissedAt),
                        lt(userNotifications.dismissedAt, dismissedCutoff),
                    ))
                    .limit(BATCH_SIZE);

                if (victims.length === 0) return totalDeleted;

                const ids = victims.map((v) => v.id);
                const deleted = await db
                    .delete(userNotifications)
                    .where(inArray(userNotifications.id, ids))
                    .returning({ id: userNotifications.id });

                totalDeleted += deleted.length;
                if (deleted.length === 0) return totalDeleted;
            }
        });

        const readDeleted = await step.run("purge-old-read", async () => {
            let totalDeleted = 0;
            while (true) {
                const victims = await db
                    .select({ id: userNotifications.id })
                    .from(userNotifications)
                    .where(and(
                        isNotNull(userNotifications.readAt),
                        lt(userNotifications.readAt, readCutoff),
                        isNull(userNotifications.dismissedAt),
                    ))
                    .limit(BATCH_SIZE);

                if (victims.length === 0) return totalDeleted;

                const ids = victims.map((v) => v.id);
                const deleted = await db
                    .delete(userNotifications)
                    .where(inArray(userNotifications.id, ids))
                    .returning({ id: userNotifications.id });

                totalDeleted += deleted.length;
                if (deleted.length === 0) return totalDeleted;
            }
        });

        const pushPruned = await step.run("prune-stale-push", async () => {
            let totalDeleted = 0;
            while (true) {
                const stalePushFilter = or(
                    lt(pushSubscriptions.lastSeenAt, stalePushCutoff),
                    sql`${pushSubscriptions.failureCount} >= ${MAX_FAILURE_COUNT}`,
                );
                const victims = await db
                    .select({ id: pushSubscriptions.id })
                    .from(pushSubscriptions)
                    .where(stalePushFilter)
                    .limit(BATCH_SIZE);

                if (victims.length === 0) return totalDeleted;

                const ids = victims.map((victim) => victim.id);
                const deleted = await db
                    .delete(pushSubscriptions)
                    .where(and(
                        inArray(pushSubscriptions.id, ids),
                        stalePushFilter,
                    ))
                    .returning({ id: pushSubscriptions.id });

                totalDeleted += deleted.length;
                if (deleted.length === 0) return totalDeleted;
            }
        });

        await step.run("write-heartbeat", async () => {
            const payload = { dismissedDeleted, readDeleted, pushPruned };
            await db.insert(jobHeartbeats)
                .values({ jobId: RETENTION_JOB_ID, lastSuccessAt: now, lastPayload: payload })
                .onConflictDoUpdate({
                    target: jobHeartbeats.jobId,
                    set: { lastSuccessAt: now, lastPayload: payload, updatedAt: now },
                });
            return payload;
        });

        logger.info("notifications.retention.completed", {
            module: "notifications",
            dismissedDeleted,
            readDeleted,
            pushPruned,
            dismissedCutoff: dismissedCutoff.toISOString(),
            readCutoff: readCutoff.toISOString(),
            stalePushCutoff: stalePushCutoff.toISOString(),
        });

        return {
            dismissedDeleted,
            readDeleted,
            pushPruned,
        };
    },
);
