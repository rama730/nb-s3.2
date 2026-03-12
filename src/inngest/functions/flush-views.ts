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
        const writeThroughEnabled = process.env.PROJECT_VIEWS_WRITE_THROUGH !== "0";

        const bufferedViews = await step.run("get-redis-views", async () => {
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
            try {
                const data = await redis!.hgetall(tempKey);
                return {
                    tempKey,
                    views: data as Record<string, string> | null,
                };
            } catch (e: any) {
                console.error("flush-views: failed to process temp key", {
                    tempKey,
                    error: e,
                });
                throw e; // Re-throw to let Inngest retry
            }
        });

        if (!bufferedViews?.views || Object.keys(bufferedViews.views).length === 0) {
            if (bufferedViews?.tempKey) {
                await redis!.del(bufferedViews.tempKey);
            }
            return { processed: 0 };
        }

        const { tempKey, views } = bufferedViews;

        if (writeThroughEnabled) {
            // Views are written directly to DB at request time. Drain legacy buffers but do not re-apply.
            await step.run("cleanup-temp-key", async () => {
                await redis!.del(tempKey);
            });
            return { processed: 0, skippedApply: true, drainedProjects: Object.keys(views).length };
        }

        const updates = await step.run("update-database", async () => {
            // Note: If scale is extreme, we could optimize this with `INSERT ... ON CONFLICT`
            // or a single transaction, but since it's only doing it once a minute,
            // sequential/parallel updates are very resilient against locks.
            const validUpdates = Object.entries(views)
                .map(([projectId, strVal]) => {
                    const increments = parseInt(strVal, 10);
                    if (isNaN(increments) || increments <= 0) return null;
                    return { projectId, increments };
                })
                .filter((entry): entry is { projectId: string; increments: number } => entry !== null);

            const results = await Promise.allSettled(
                validUpdates.map(async ({ projectId, increments }) => {
                    await db.update(projects)
                        .set({ viewCount: sql`${projects.viewCount} + ${increments}` })
                        .where(eq(projects.id, projectId));

                    return projectId;
                })
            );

            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results
                .map((result, index) => ({ result, index }))
                .filter(({ result }) => result.status === 'rejected')
                .map(({ index }) => validUpdates[index]);

            if (failed.length > 0) {
                console.error("flush-views: project view updates failed", {
                    failedCount: failed.length,
                    failedProjectIds: failed.map(({ projectId }) => projectId),
                    reasons: results
                        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                        .map((r) => r.reason),
                });

                // Requeue only the failed increments so they can be retried in the next flush.
                const requeueResults = await Promise.allSettled(
                    failed.map(({ projectId, increments }) =>
                        redis!.hincrby("project:views", projectId, increments)
                    )
                );

                const requeueFailures = requeueResults
                    .map((result, index) => ({
                        result,
                        projectId: failed[index]?.projectId,
                        increments: failed[index]?.increments,
                    }))
                    .filter(
                        (
                            entry,
                        ): entry is {
                            result: PromiseRejectedResult;
                            projectId: string;
                            increments: number;
                        } =>
                            entry.result.status === 'rejected'
                            && typeof entry.projectId === 'string'
                            && typeof entry.increments === 'number',
                    );

                if (requeueFailures.length > 0) {
                    console.error("flush-views: failed to requeue increments", {
                        failedCount: requeueFailures.length,
                        failedProjectIds: requeueFailures.map(({ projectId }) => projectId),
                        failures: requeueFailures.map(({ projectId, increments, result }) => ({
                            projectId,
                            increments,
                            reason: result.reason,
                        })),
                    });
                }
            }

            await redis!.del(tempKey);

            return { succeeded, failed: failed.length };
        });

        return { processed: updates.succeeded, requeued: updates.failed };
    }
);
