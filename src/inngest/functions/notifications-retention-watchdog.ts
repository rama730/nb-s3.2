import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

import { inngest } from "../client";
import { RETENTION_JOB_ID } from "./notifications-retention";

const STALE_THRESHOLD_HOURS = 36;

/**
 * Watchdog for the nightly notifications-retention job. Runs every 6 hours
 * and logs a critical error if the retention job has not successfully
 * completed in the last 36 hours.
 *
 * The retention job is on a 24h cron, so a 36h gap indicates at least one
 * missed run. Surfacing it via structured logs lets existing log alerting
 * (Datadog / Axiom) page an on-call engineer.
 */
export const notificationsRetentionWatchdog = inngest.createFunction(
    { id: "notifications-retention-watchdog", retries: 0 },
    { cron: "0 */6 * * *" },
    async ({ step }) => {
        const result = await step.run("check-heartbeat", async () => {
            const rows = await db
                .select({ lastSuccessAt: jobHeartbeats.lastSuccessAt })
                .from(jobHeartbeats)
                .where(eq(jobHeartbeats.jobId, RETENTION_JOB_ID))
                .limit(1);
            const row = rows[0];
            return row ? { lastSuccessIso: row.lastSuccessAt.toISOString() } : null;
        });

        const now = Date.now();

        if (!result) {
            logger.error("notifications.retention.watchdog.missing_heartbeat", {
                module: "notifications",
                jobId: RETENTION_JOB_ID,
                reason: "no heartbeat row — retention job has never succeeded",
            });
            return { healthy: false, reason: "missing_heartbeat" };
        }

        const lastSuccessMs = Date.parse(result.lastSuccessIso);
        const ageHours = (now - lastSuccessMs) / (60 * 60 * 1000);

        if (ageHours > STALE_THRESHOLD_HOURS) {
            logger.error("notifications.retention.watchdog.stale", {
                module: "notifications",
                jobId: RETENTION_JOB_ID,
                lastSuccessAt: result.lastSuccessIso,
                ageHours: Math.round(ageHours * 10) / 10,
                thresholdHours: STALE_THRESHOLD_HOURS,
            });
            return { healthy: false, reason: "stale", ageHours };
        }

        return { healthy: true, ageHours: Math.round(ageHours * 10) / 10 };
    },
);
