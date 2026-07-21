import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import {
  purgeCleanSessionRecoveryDrafts,
  purgeExpiredExtensionRecoveryDrafts,
} from "@/lib/extension/recovery-drafts";
import { purgeOrphanedExtensionRecoverySessions } from "@/lib/extension/recovery-sessions";
import { logger } from "@/lib/logger";

import { inngest } from "../client";

export const EXTENSION_RECOVERY_RETENTION_JOB_ID = "extension-recovery-retention";

export const extensionRecoveryRetention = inngest.createFunction(
  { id: EXTENSION_RECOVERY_RETENTION_JOB_ID, retries: 2 },
  { cron: "30 3 * * *" },
  async ({ step }) => {
    let deleted = 0;
    let batch = 0;
    while (batch < 20) {
      const count = await step.run(`purge-expired-${batch}`, () =>
        purgeExpiredExtensionRecoveryDrafts(500),
      );
      deleted += count;
      batch += 1;
      if (count < 500) break;
    }

    let deletedCleanDrafts = 0;
    let cleanBatch = 0;
    while (cleanBatch < 20) {
      const count = await step.run(`purge-clean-drafts-${cleanBatch}`, () =>
        purgeCleanSessionRecoveryDrafts(500),
      );
      deletedCleanDrafts += count;
      cleanBatch += 1;
      if (count < 500) break;
    }

    let deletedSessions = 0;
    let sessionBatch = 0;
    while (sessionBatch < 10) {
      const count = await step.run(`purge-sessions-${sessionBatch}`, () =>
        purgeOrphanedExtensionRecoverySessions(500),
      );
      deletedSessions += count;
      sessionBatch += 1;
      if (count < 500) break;
    }

    await step.run("write-heartbeat", async () => {
      const now = new Date();
      await db.insert(jobHeartbeats)
        .values({
          jobId: EXTENSION_RECOVERY_RETENTION_JOB_ID,
          lastSuccessAt: now,
          lastPayload: { deleted, batches: batch, deletedCleanDrafts, cleanBatches: cleanBatch, deletedSessions, sessionBatches: sessionBatch },
        })
        .onConflictDoUpdate({
          target: jobHeartbeats.jobId,
          set: {
            lastSuccessAt: now,
            lastPayload: { deleted, batches: batch, deletedCleanDrafts, cleanBatches: cleanBatch, deletedSessions, sessionBatches: sessionBatch },
            updatedAt: now,
          },
        });
    });

    logger.info("extension.recovery.retention.completed", {
      module: "extension",
      deleted,
      batches: batch,
      deletedCleanDrafts,
      cleanBatches: cleanBatch,
      deletedSessions,
      sessionBatches: sessionBatch,
    });
    return { deleted, batches: batch, deletedCleanDrafts, cleanBatches: cleanBatch, deletedSessions, sessionBatches: sessionBatch };
  },
);
