import { inngest } from "../client";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { applyConnectionsCountIncrements, invalidateDiscoverCacheForUsers, revalidateConnectionsPaths, syncConnectionsToRedis } from "@/app/actions/connections";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";

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
        const { userId, action, limit } = event.data;
        const BATCH_SIZE = 200;
        let processedCount = 0;
        let hasMore = true;

        while (hasMore && processedCount < limit) {
            const currentBatchLimit = Math.min(BATCH_SIZE, limit - processedCount);

            const batchResult = await step.run(`process-batch-${processedCount}`, async () => {
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

                // Fire and forget cache invalidations per batch
                await step.run(`invalidate-caches-${processedCount}`, async () => {
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

        return { processedCount };
    }
);
