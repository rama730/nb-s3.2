import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { finishPermanentDelete } from "@/lib/files/permanent-delete";
import { logger } from "@/lib/logger";
import { inngest } from "../client";

// Durable tombstones also cover a process crash before any event is dispatched.
export const finishPendingFileDeletions = inngest.createFunction(
  { id: "project-files-permanent-delete", retries: 2, concurrency: 1 },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const pending = await step.run("read-pending-deletions", () =>
      db
        .select({ id: projectNodes.id, projectId: projectNodes.projectId })
        .from(projectNodes)
        .where(
          and(
            isNotNull(projectNodes.deletedAt),
            sql`${projectNodes.metadata}->>'permanentDeleteRoot' = ${projectNodes.id}::text`,
          ),
        )
        .orderBy(asc(projectNodes.updatedAt))
        .limit(10),
    );
    for (const node of pending)
      await step.run(`finish-${node.id}`, async () => {
        try {
          return await finishPermanentDelete(node.projectId, node.id);
        } catch (error) {
          // Rotate failed work behind other tombstones; one unavailable blob must
          // not starve unrelated deletions. The durable intent remains retryable.
          await db
            .update(projectNodes)
            .set({ updatedAt: new Date() })
            .where(
              and(
                eq(projectNodes.id, node.id),
                eq(projectNodes.projectId, node.projectId),
              ),
            );
          logger.error("File deletion cleanup will retry", {
            projectId: node.projectId,
            nodeId: node.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return { pending: true };
        }
      });
    return { processed: pending.length };
  },
);
