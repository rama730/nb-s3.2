import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

import { inngest } from "../client";

const PARTICIPANT_SAMPLE_SIZE = 500;

type IntegrityCounts = {
  unread_drift_count: number;
  preview_drift_count: number;
  dm_pair_drift_count: number;
  expired_upload_count: number;
};

export const messageDataIntegrityAudit = inngest.createFunction(
  {
    id: "message-data-integrity-audit",
    name: "Audit message data invariants",
    retries: 2,
  },
  { cron: "17 3 * * *" },
  async ({ step }) => {
    const result = await step.run("count-message-invariant-drift", async () => {
      const rows = Array.from(await db.execute<IntegrityCounts>(sql`
        WITH sampled_participants AS (
          SELECT
            cp.conversation_id,
            cp.user_id,
            cp.unread_count,
            cp.last_read_at,
            cp.last_read_message_id,
            cp.last_message_id,
            cp.last_message_at
          FROM conversation_participants cp
          ORDER BY cp.last_message_at DESC NULLS LAST, cp.conversation_id DESC
          LIMIT ${PARTICIPANT_SAMPLE_SIZE}
        ),
        participant_drift AS (
          SELECT
            sp.conversation_id,
            sp.user_id,
            (
              SELECT count(*)::int
              FROM messages m
              WHERE m.conversation_id = sp.conversation_id
                AND m.sender_id IS DISTINCT FROM sp.user_id
                AND m.deleted_at IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM message_hidden_for_users hidden
                  WHERE hidden.message_id = m.id
                    AND hidden.user_id = sp.user_id
                )
                AND (
                  sp.last_read_at IS NULL
                  OR (m.created_at, m.id) > (
                    sp.last_read_at,
                    coalesce(sp.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  )
                )
            ) AS derived_unread_count,
            latest.id AS derived_last_message_id,
            latest.created_at AS derived_last_message_at,
            sp.unread_count,
            sp.last_message_id,
            sp.last_message_at
          FROM sampled_participants sp
          LEFT JOIN LATERAL (
            SELECT m.id, m.created_at
            FROM messages m
            WHERE m.conversation_id = sp.conversation_id
              AND m.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM message_hidden_for_users hidden
                WHERE hidden.message_id = m.id
                  AND hidden.user_id = sp.user_id
              )
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
          ) latest ON true
        ),
        dm_pair_drift AS (
          SELECT dp.conversation_id
          FROM dm_pairs dp
          WHERE (
            SELECT count(*)
            FROM conversation_participants cp
            WHERE cp.conversation_id = dp.conversation_id
          ) <> 2
          OR NOT EXISTS (
            SELECT 1
            FROM conversation_participants cp
            WHERE cp.conversation_id = dp.conversation_id
              AND cp.user_id = dp.user_low
          )
          OR NOT EXISTS (
            SELECT 1
            FROM conversation_participants cp
            WHERE cp.conversation_id = dp.conversation_id
              AND cp.user_id = dp.user_high
          )
        )
        SELECT
          (
            SELECT count(*)::int
            FROM participant_drift
            WHERE unread_count <> derived_unread_count
          ) AS unread_drift_count,
          (
            SELECT count(*)::int
            FROM participant_drift
            WHERE last_message_id IS DISTINCT FROM derived_last_message_id
               OR last_message_at IS DISTINCT FROM derived_last_message_at
          ) AS preview_drift_count,
          (SELECT count(*)::int FROM dm_pair_drift) AS dm_pair_drift_count,
          (
            SELECT count(*)::int
            FROM attachment_uploads
            WHERE status NOT IN ('committed', 'expired')
              AND expires_at IS NOT NULL
              AND expires_at <= now()
          ) AS expired_upload_count
      `));
      return rows[0] ?? {
        unread_drift_count: 0,
        preview_drift_count: 0,
        dm_pair_drift_count: 0,
        expired_upload_count: 0,
      };
    });

    const checks = [
      ["unread", result.unread_drift_count],
      ["preview", result.preview_drift_count],
      ["dm-pair", result.dm_pair_drift_count],
      ["expired-upload", result.expired_upload_count],
    ] as const;

    for (const [kind, count] of checks) {
      logger.metric("messages.integrity.drift", {
        module: "messaging",
        kind,
        count,
        limit: kind === "unread" || kind === "preview" ? PARTICIPANT_SAMPLE_SIZE : undefined,
      });
      if (count > 0) {
        logger.warn("messages.integrity.drift_detected", {
          module: "messaging",
          kind,
          count,
        });
      }
    }

    return {
      sampleSize: PARTICIPANT_SAMPLE_SIZE,
      unreadDrift: result.unread_drift_count,
      previewDrift: result.preview_drift_count,
      dmPairDrift: result.dm_pair_drift_count,
      expiredUploads: result.expired_upload_count,
    };
  },
);
