import { inngest } from "../client";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const flushProjectViews = inngest.createFunction(
    { id: "flush-project-views", name: "Flush Project Views from Redis" },
    { cron: "* * * * *" }, // Run every minute for highly consistent eventual view counts
    async ({ step }) => {
        if (!redis) return { skipped: true, reason: "No Redis configured" };

        const views = await step.run("get-redis-views", async () => {
            // Atomic RENAME to prevent race condition:
            // Any hincrby calls after RENAME go to a fresh "project:views" key,
            // while we safely read from the temp key without losing data.
            const tempKey = `project:views:flush:${Date.now()}`;
            try {
                await redis!.rename("project:views", tempKey);
            } catch (e: any) {
                // RENAME fails if the source key doesn't exist (no views buffered)
                return null;
            }
            const data = await redis!.hgetall(tempKey);
            await redis!.del(tempKey); // Clean up temp key
            return data as Record<string, string> | null;
        });

        if (!views || Object.keys(views).length === 0) {
            return { processed: 0 };
        }

        const updates = await step.run("update-database", async () => {
            let count = 0;

            // Note: If scale is extreme, we could optimize this with `INSERT ... ON CONFLICT`
            // or a single transaction, but since it's only doing it once a minute,
            // sequential/parallel updates are very resilient against locks.
            const promises = Object.entries(views).map(async ([projectId, strVal]) => {
                const increments = parseInt(strVal, 10);
                if (isNaN(increments) || increments <= 0) return;

                await db.update(projects)
                    .set({ viewCount: sql`${projects.viewCount} + ${increments}` })
                    .where(eq(projects.id, projectId));

                count++;
            });

            await Promise.all(promises);
            return count;
        });

        return { processed: updates };
    }
);
