import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

import { inngest } from "../client";

export const DATA_LIFECYCLE_RETENTION = {
  profileReadAuditDays: 30,
  profileActivityAuditDays: 365,
  onboardingTelemetryDays: 90,
  extensionSessionEventDays: 180,
  batchSize: 500,
} as const;

export const DATA_LIFECYCLE_RETENTION_JOB_ID = "data-lifecycle-retention";

export const dataLifecycleRetention = inngest.createFunction(
  {
    id: DATA_LIFECYCLE_RETENTION_JOB_ID,
    retries: 2,
    concurrency: { limit: 1 },
  },
  { cron: "43 3 * * *" },
  async ({ step }) => {
    const counts = await step.run("delete-expired-lifecycle-records", async () => {
      const [result] = Array.from(await db.execute<{
        profile_read_audits: number;
        profile_activity_audits: number;
        onboarding_events: number;
        extension_session_events: number;
        legal_acceptances: number;
        account_deletion_records_anonymized: number;
      }>(sql`
        WITH expired_profile_reads AS (
          SELECT id FROM profile_audit_events
          WHERE event_type IN (
            'profile_viewed', 'discover_profile_served', 'network_profile_served',
            'conversation_opened', 'message_history_read'
          )
            AND created_at < now() - (${DATA_LIFECYCLE_RETENTION.profileReadAuditDays} * interval '1 day')
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${DATA_LIFECYCLE_RETENTION.batchSize}
        ), deleted_profile_reads AS (
          DELETE FROM profile_audit_events event
          USING expired_profile_reads expired
          WHERE event.id = expired.id
          RETURNING event.id
        ), expired_profile_activity AS (
          SELECT id FROM profile_audit_events
          WHERE event_type NOT IN (
            'profile_viewed', 'discover_profile_served', 'network_profile_served',
            'conversation_opened', 'message_history_read'
          )
            AND created_at < now() - (${DATA_LIFECYCLE_RETENTION.profileActivityAuditDays} * interval '1 day')
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${DATA_LIFECYCLE_RETENTION.batchSize}
        ), deleted_profile_activity AS (
          DELETE FROM profile_audit_events event
          USING expired_profile_activity expired
          WHERE event.id = expired.id
          RETURNING event.id
        ), expired_onboarding AS (
          SELECT id FROM onboarding_events
          WHERE created_at < now() - (${DATA_LIFECYCLE_RETENTION.onboardingTelemetryDays} * interval '1 day')
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${DATA_LIFECYCLE_RETENTION.batchSize}
        ), deleted_onboarding AS (
          DELETE FROM onboarding_events event
          USING expired_onboarding expired
          WHERE event.id = expired.id
          RETURNING event.id
        ), expired_extension_events AS (
          SELECT id FROM extension_device_session_events
          WHERE created_at < now() - (${DATA_LIFECYCLE_RETENTION.extensionSessionEventDays} * interval '1 day')
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${DATA_LIFECYCLE_RETENTION.batchSize}
        ), deleted_extension_events AS (
          DELETE FROM extension_device_session_events event
          USING expired_extension_events expired
          WHERE event.id = expired.id
          RETURNING event.id
        ), expired_legal_acceptances AS (
          SELECT id FROM legal_acceptances
          WHERE retention_expires_at < now()
          ORDER BY retention_expires_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${DATA_LIFECYCLE_RETENTION.batchSize}
        ), deleted_legal_acceptances AS (
          DELETE FROM legal_acceptances acceptance
          USING expired_legal_acceptances expired
          WHERE acceptance.id = expired.id
          RETURNING acceptance.id
        ), expired_account_deletion_records AS (
          SELECT id FROM account_deletions
          WHERE completed_at IS NOT NULL
            AND legal_retention_until < now()
            AND user_id IS DISTINCT FROM id
          ORDER BY legal_retention_until, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${DATA_LIFECYCLE_RETENTION.batchSize}
        ), anonymized_account_deletion_records AS (
          UPDATE account_deletions deletion
          SET user_id = deletion.id,
              email = 'deleted-account@invalid',
              username = NULL,
              reason = NULL,
              metadata = '{}'::jsonb,
              cleanup_details = jsonb_build_object(
                'anonymized', true,
                'anonymizedAt', now()
              )
          FROM expired_account_deletion_records expired
          WHERE deletion.id = expired.id
          RETURNING deletion.id
        )
        SELECT
          (SELECT count(*)::int FROM deleted_profile_reads) AS profile_read_audits,
          (SELECT count(*)::int FROM deleted_profile_activity) AS profile_activity_audits,
          (SELECT count(*)::int FROM deleted_onboarding) AS onboarding_events,
          (SELECT count(*)::int FROM deleted_extension_events) AS extension_session_events,
          (SELECT count(*)::int FROM deleted_legal_acceptances) AS legal_acceptances,
          (SELECT count(*)::int FROM anonymized_account_deletion_records) AS account_deletion_records_anonymized
      `));

      return result ?? {
        profile_read_audits: 0,
        profile_activity_audits: 0,
        onboarding_events: 0,
        extension_session_events: 0,
        legal_acceptances: 0,
        account_deletion_records_anonymized: 0,
      };
    });

    await step.run("write-retention-heartbeat", async () => {
      const now = new Date();
      await db.insert(jobHeartbeats).values({
        jobId: DATA_LIFECYCLE_RETENTION_JOB_ID,
        lastSuccessAt: now,
        lastPayload: counts,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: jobHeartbeats.jobId,
        set: { lastSuccessAt: now, lastPayload: counts, updatedAt: now },
      });
    });

    logger.metric("data.lifecycle.retention", {
      module: "data-lifecycle",
      ...counts,
    });
    return counts;
  },
);
