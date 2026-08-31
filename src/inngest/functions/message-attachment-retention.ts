import { inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { attachmentUploads } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";

import { inngest } from "../client";

const ATTACHMENTS_BUCKET = "chat-attachments";
const CLEANUP_BATCH_SIZE = 50;

export const messageAttachmentRetention = inngest.createFunction(
  {
    id: "message-attachment-retention",
    name: "Expire and remove uncommitted message attachments",
    retries: 3,
  },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const claimed = await step.run("claim-expired-uploads", async () => {
      return db.transaction(async (tx) => {
        return tx.execute<{
          id: string;
          storage_path: string | null;
        }>(sql`
          WITH candidates AS (
            SELECT id
            FROM ${attachmentUploads}
            WHERE status <> 'committed'
              AND (
                (expires_at IS NOT NULL AND expires_at <= now())
                OR error LIKE 'cleanup_pending:%'
              )
            ORDER BY updated_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${CLEANUP_BATCH_SIZE}
          )
          UPDATE ${attachmentUploads} upload
          SET
            status = 'expired',
            error = 'cleanup_in_progress',
            updated_at = now()
          FROM candidates
          WHERE upload.id = candidates.id
          RETURNING upload.id, upload.storage_path
        `);
      });
    });

    const rows = Array.from(claimed);
    if (rows.length === 0) {
      return { claimed: 0, deleted: 0, failed: 0 };
    }

    const paths = Array.from(new Set(
      rows
        .map((row) => row.storage_path)
        .filter((path): path is string => Boolean(path)),
    ));
    let cleanupError: string | null = null;
    if (paths.length > 0) {
      cleanupError = await step.run("remove-expired-objects", async () => {
        const admin = await createAdminClient();
        const { error } = await admin.storage.from(ATTACHMENTS_BUCKET).remove(paths);
        return error?.message ?? null;
      });
    }

    const ids = rows.map((row) => row.id);
    if (cleanupError) {
      await step.run("record-cleanup-retry", async () => {
        await db
          .update(attachmentUploads)
          .set({
            status: "failed",
            error: `cleanup_pending:${cleanupError}`,
            updatedAt: new Date(),
          })
          .where(inArray(attachmentUploads.id, ids));
      });
      logger.error("messages.attachments.cleanup_failed", {
        module: "messaging",
        count: ids.length,
        error: cleanupError,
      });
      return { claimed: ids.length, deleted: 0, failed: ids.length };
    }

    await step.run("finalize-expired-uploads", async () => {
      await db
        .update(attachmentUploads)
        .set({
          storagePath: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(inArray(attachmentUploads.id, ids));
    });

    return { claimed: ids.length, deleted: paths.length, failed: 0 };
  },
);
