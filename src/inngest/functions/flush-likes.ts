import { inngest } from "../client";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { projectUpdates } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const flushUpdateLikes = inngest.createFunction(
    { id: "flush-project-likes", name: "Flush Project Update Likes from Redis" },
    { cron: "* * * * *" }, // Run every minute for eventual count consistency
    async ({ step }) => {
        if (!redis) return { skipped: true, reason: "No Redis configured" };

        const bufferedLikes = await step.run("get-redis-likes", async () => {
            const tempKey = `project:updates:likes:flush:${Date.now()}`;
            try {
                await redis!.rename("project:updates:likes", tempKey);
            } catch (e: any) {
                // RENAME fails if source key doesn't exist (no likes buffered)
                return null;
            }
            try {
                const data = await redis!.hgetall(tempKey);
                return {
                    tempKey,
                    likes: data as Record<string, string> | null,
                };
            } catch (e: any) {
                console.error("flush-likes: failed to process temp key", {
                    tempKey,
                    error: e,
                });
                throw e; // Re-throw to let Inngest retry
            }
        });

        if (!bufferedLikes?.likes || Object.keys(bufferedLikes.likes).length === 0) {
            if (bufferedLikes?.tempKey) {
                await redis!.del(bufferedLikes.tempKey);
            }
            return { processed: 0 };
        }

        const { tempKey, likes } = bufferedLikes;

        const updates = await step.run("update-database", async () => {
            const validUpdates = Object.entries(likes)
                .map(([updateId, strVal]) => {
                    const increments = parseInt(strVal, 10);
                    if (isNaN(increments) || increments === 0) return null;
                    return { updateId, increments };
                })
                .filter((entry): entry is { updateId: string; increments: number } => entry !== null);

            const results = await Promise.allSettled(
                validUpdates.map(async ({ updateId, increments }) => {
                    if (increments > 0) {
                        await db.update(projectUpdates)
                            .set({ likeCount: sql`${projectUpdates.likeCount} + ${increments}`, updatedAt: new Date() })
                            .where(eq(projectUpdates.id, updateId));
                    } else if (increments < 0) {
                        await db.update(projectUpdates)
                            .set({ likeCount: sql`GREATEST(${projectUpdates.likeCount} - ${Math.abs(increments)}, 0)`, updatedAt: new Date() })
                            .where(eq(projectUpdates.id, updateId));
                    }
                    return updateId;
                })
            );

            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results
                .map((result, index) => ({ result, index }))
                .filter(({ result }) => result.status === 'rejected')
                .map(({ index }) => validUpdates[index]);

            if (failed.length > 0) {
                console.error("flush-likes: update failed", {
                    failedCount: failed.length,
                    failedUpdateIds: failed.map((f) => f?.updateId).filter(Boolean),
                });

                // Requeue only the failed increments to retry in the next flush
                await Promise.allSettled(
                    failed
                        .filter((f): f is NonNullable<typeof f> => !!f)
                        .map(({ updateId, increments }) =>
                            redis!.hincrby("project:updates:likes", updateId, increments)
                        )
                );
            }

            await redis!.del(tempKey);

            return { succeeded, failed: failed.length };
        });

        return { processed: updates.succeeded, requeued: updates.failed };
    }
);
