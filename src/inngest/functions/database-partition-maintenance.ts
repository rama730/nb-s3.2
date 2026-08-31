import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

import { inngest } from "../client";

export const DATABASE_PARTITION_MAINTENANCE_JOB_ID =
  "database-partition-maintenance";

export const databasePartitionMaintenance = inngest.createFunction(
  {
    id: DATABASE_PARTITION_MAINTENANCE_JOB_ID,
    retries: 2,
    concurrency: { limit: 1 },
  },
  { cron: "15 4 1 * *" },
  async ({ step }) => {
    await step.run("create-future-partitions", () =>
      db.execute(sql`SELECT public.create_future_partitions()`),
    );

    const [defaultRows] = await step.run("count-default-partition-rows", async () =>
      Array.from(await db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM public.project_node_events_default
      `)),
    );
    const defaultRowCount = defaultRows?.count ?? 0;
    logger.metric("database.partition.default_rows", {
      module: "database",
      count: defaultRowCount,
    });
    if (defaultRowCount > 0) {
      logger.warn("database.partition.default_rows_present", {
        module: "database",
        count: defaultRowCount,
      });
    }

    await step.run("write-heartbeat", async () => {
      const now = new Date();
      await db
        .insert(jobHeartbeats)
        .values({
          jobId: DATABASE_PARTITION_MAINTENANCE_JOB_ID,
          lastSuccessAt: now,
          lastPayload: { completedAt: now.toISOString(), defaultRowCount },
        })
        .onConflictDoUpdate({
          target: jobHeartbeats.jobId,
          set: {
            lastSuccessAt: now,
            lastPayload: { completedAt: now.toISOString(), defaultRowCount },
            updatedAt: now,
          },
        });
    });

    return { success: true, defaultRowCount };
  },
);
