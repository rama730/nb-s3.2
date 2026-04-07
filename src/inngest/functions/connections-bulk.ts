import { inngest } from "../client";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { applyConnectionsCountIncrements, invalidateDiscoverCacheForUsers, revalidateConnectionsPaths, syncConnectionsToRedis } from "@/app/actions/connections";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";
import { redis } from "@/lib/redis";

function sanitizeBulkJobError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (!normalized) return "Bulk connection processing failed";
    return normalized.slice(0, 200);
}

export const processBulkConnections = inngest.createFunction(
    {
        id: "workspace-connections-bulk",
        name: "Process Bulk Connections",
        concurrency: {
            limit: 5,
        },
    },
    { event: "workspace/connections.bulk" },
    async ({ event, step }) => {
        const { userId, action, limit, jobId } = event.data;
        const BATCH_SIZE = 200;
        let processedCount = 0;
        let batchIndex = 0;
        let hasMore = true;

        // Initialize progress tracking in Redis
        if (jobId && redis) {
            await step.run("init-progress", async () => {
                const key = `bulk_job:${jobId}`;
                const [pendingCountRow] = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(connections)
                    .where(and(eq(connections.addresseeId, userId), eq(connections.status, "pending")));
                const pendingCount = Number(pendingCountRow?.count ?? 0);
                const total = Math.min(limit, pendingCount);

                await (
                    redis as unknown as {
                        eval: (
                            script: string,
                            keys: string[],
                            args: string[],
                        ) => Promise<number | string | null>;
                    }
                ).eval(
                    `
                        if redis.call("exists", KEYS[1]) == 0 then
                            redis.call(
                                "hmset",
                                KEYS[1],
                                "total", ARGV[1],
                                "completed", "0",
                                "failed", "0",
                                "status", "running"
                            )
                            redis.call("expire", KEYS[1], ARGV[2])
                            return 1
                        end
                        return 0
                    `,
                    [key],
                    [String(total), "3600"],
                );
            });
        }

        try {
            while (hasMore && processedCount < limit) {
                const currentBatchLimit = Math.min(BATCH_SIZE, limit - processedCount);

                const currentBatchIndex = batchIndex;
                const batchResult = await step.run(`process-batch-${currentBatchIndex}`, async () => {
                    return await db.transaction(async (tx) => {
                        const rows = await tx
                            .select({
                                id: connections.id,
                                requesterId: connections.requesterId,
                                addresseeId: connections.addresseeId,
                            })
                            .from(connections)
                            .where(and(eq(connections.addresseeId, userId), eq(connections.status, 'pending')))
                            .orderBy(desc(connections.createdAt))
                            .limit(currentBatchLimit);

                        if (rows.length === 0) return { updatedRows: [] };

                        const ids = rows.map(r => r.id);
                        const updated = await tx
                            .update(connections)
                            .set({
                                status: action === 'accept' ? 'accepted' : 'rejected',
                                updatedAt: new Date(),
                            })
                            .where(and(inArray(connections.id, ids), eq(connections.status, 'pending')))
                            .returning({
                                requesterId: connections.requesterId,
                                addresseeId: connections.addresseeId,
                            });

                        if (updated.length > 0 && action === 'accept') {
                            const increments = new Map<string, number>();
                            for (const row of updated) {
                                increments.set(row.requesterId, (increments.get(row.requesterId) || 0) + 1);
                                increments.set(row.addresseeId, (increments.get(row.addresseeId) || 0) + 1);
                            }
                            await applyConnectionsCountIncrements(tx, increments);
                        }

                        return { updatedRows: updated };
                    });
                });

                const { updatedRows } = batchResult;

                if (updatedRows.length > 0) {
                    processedCount += updatedRows.length;

                    // Track batch progress in Redis
                    if (jobId && redis) {
                        await step.run(`track-progress-${currentBatchIndex}`, async () => {
                            await redis!.hincrby(`bulk_job:${jobId}`, "completed", updatedRows.length);
                        });
                    }

                    // Fire and forget cache invalidations per batch
                    await step.run(`invalidate-caches-${currentBatchIndex}`, async () => {
                        if (action === 'accept') {
                            await queueCounterRefreshBestEffort([userId]);
                        }
                        await invalidateDiscoverCacheForUsers(
                            updatedRows.flatMap(row => [row.requesterId, row.addresseeId])
                        );
                    });
                } else {
                    hasMore = false;
                }

                batchIndex += 1;
            }

            if (processedCount > 0) {
                await step.run('sync-cache-and-suggestions', async () => {
                    if (action === 'accept') {
                        // Sync the addressee (the one doing the bulk action)
                        await syncConnectionsToRedis(userId);
                        await inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId } });
                    }
                });

                await step.run('revalidate-ui', async () => {
                    await revalidateConnectionsPaths();
                });
            }

            // Mark job as done in Redis
            if (jobId && redis) {
                await step.run("finalize-progress", async () => {
                    await redis!.hset(`bulk_job:${jobId}`, { status: "done" });
                });
            }

            return { processedCount };
        } catch (error) {
            const originalError = error;
            if (jobId && redis) {
                try {
                    await step.run("fail-progress", async () => {
                        const key = `bulk_job:${jobId}`;
                        const hash = await redis!.hgetall(key);
                        const total = Number(hash?.total ?? 0);
                        const completed = Math.min(processedCount, total);
                        const failed = Math.max(total - completed, 0);

                        await redis!.hset(key, {
                            completed: String(completed),
                            failed: String(failed),
                            status: "failed",
                            error: sanitizeBulkJobError(originalError),
                        });
                    });
                } catch (progressError) {
                    console.error("[connections-bulk] failed to record job failure state", progressError);
                }
            }
            throw originalError;
        }
    }
);
