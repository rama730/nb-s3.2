import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  jobHeartbeats,
  notificationDeliveries,
  profiles,
  userNotifications,
} from "@/lib/db/schema";
import {
  getNotificationPauseUntil,
  getQuietHoursResumeAt,
  isNotificationPauseActive,
  isQuietHoursActive,
  normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import { toNotificationItem } from "@/lib/notifications/service";
import { dispatchWebPush } from "@/lib/notifications/web-push";

import { inngest } from "../client";

export const NOTIFICATION_PUSH_DELIVERY_JOB_ID = "notification-push-delivery";

const DELIVERY_BATCH_SIZE = 100;
const DELIVERY_CONCURRENCY = 10;

/**
 * Canonical, post-commit owner for important web-push delivery.
 *
 * The durable notification row is the outbox record. A delivery attempt log
 * closes that record, while snoozed/quiet-hours rows remain eligible only when
 * their delay expires. This prevents external delivery from escaping a rolled
 * back source transaction and gives delayed notifications one bounded resume
 * path.
 */
export const notificationPushDelivery = inngest.createFunction(
  {
    id: NOTIFICATION_PUSH_DELIVERY_JOB_ID,
    retries: 2,
    concurrency: { limit: 1 },
  },
  { cron: "* * * * *" },
  async ({ step }) => {
    const result = await step.run("deliver-due-web-push", async () => {
      const now = new Date();
      const rows = await db
        .select({
          notification: userNotifications,
          notificationPreferences: profiles.notificationPreferences,
        })
        .from(userNotifications)
        .innerJoin(profiles, eq(profiles.id, userNotifications.userId))
        .where(and(
          eq(userNotifications.importance, "important"),
          isNull(userNotifications.dismissedAt),
          or(
            isNull(userNotifications.snoozedUntil),
            lte(userNotifications.snoozedUntil, now),
          ),
          sql`NOT EXISTS (
            SELECT 1
            FROM ${notificationDeliveries} delivery
            WHERE delivery.notification_id = ${userNotifications.id}
              AND delivery.channel = 'web_push'
              AND delivery.status IN ('delivered', 'dropped')
          )`,
        ))
        .orderBy(asc(userNotifications.createdAt), asc(userNotifications.id))
        .limit(DELIVERY_BATCH_SIZE);

      let delivered = 0;
      let dropped = 0;
      let delayed = 0;

      for (let index = 0; index < rows.length; index += DELIVERY_CONCURRENCY) {
        const chunk = rows.slice(index, index + DELIVERY_CONCURRENCY);
        const outcomes = await Promise.all(chunk.map(async (row) => {
          const preferences = normalizeNotificationPreferences(row.notificationPreferences);
          if (!preferences.delivery.push) {
            await db.insert(notificationDeliveries).values({
              notificationId: row.notification.id,
              userId: row.notification.userId,
              channel: "web_push",
              status: "dropped",
              errorCode: "push_disabled",
              errorMessage: null,
            });
            return "dropped" as const;
          }

          const currentTime = new Date();
          const delayUntil = isNotificationPauseActive(preferences, currentTime)
            ? getNotificationPauseUntil(preferences, currentTime)
            : isQuietHoursActive(preferences, currentTime)
              ? getQuietHoursResumeAt(preferences, currentTime)
              : null;
          if (delayUntil && delayUntil > currentTime) {
            await db
              .update(userNotifications)
              .set({ snoozedUntil: delayUntil, updatedAt: currentTime })
              .where(and(
                eq(userNotifications.id, row.notification.id),
                or(
                  isNull(userNotifications.snoozedUntil),
                  lte(userNotifications.snoozedUntil, currentTime),
                ),
              ));
            return "delayed" as const;
          }

          const dispatch = await dispatchWebPush(
            row.notification.userId,
            toNotificationItem(row.notification),
          );
          return dispatch.delivered > 0 ? "delivered" as const : "dropped" as const;
        }));

        delivered += outcomes.filter((outcome) => outcome === "delivered").length;
        dropped += outcomes.filter((outcome) => outcome === "dropped").length;
        delayed += outcomes.filter((outcome) => outcome === "delayed").length;
      }

      return { scanned: rows.length, delivered, dropped, delayed };
    });

    await step.run("write-heartbeat", async () => {
      const now = new Date();
      await db.insert(jobHeartbeats)
        .values({
          jobId: NOTIFICATION_PUSH_DELIVERY_JOB_ID,
          lastSuccessAt: now,
          lastPayload: result,
        })
        .onConflictDoUpdate({
          target: jobHeartbeats.jobId,
          set: { lastSuccessAt: now, lastPayload: result, updatedAt: now },
        });
    });

    return result;
  },
);
