import { and, eq, sql, gt, lt, lte, or, inArray } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db";
import { connections, dmPairs, conversationParticipants, profiles } from "@/lib/db/schema";
import { getRedisClient } from "@/lib/redis";

/**
 * Dormant Connection Audit — Periodically identifies inactive connections
 * and flags them for "Reconnect" prompts.
 *
 * ALSO: Populates username:id cache for Edge Middleware hydration.
 */
export const dormantConnectionsAudit = inngest.createFunction(
    { id: "dormant-connections-audit", retries: 1 },
    { cron: "0 2 * * 1" }, // Every Monday at 2 AM
    async ({ step }) => {
        const thresholdDate = new Date();
        thresholdDate.setMonth(thresholdDate.getMonth() - 6);
        const thresholdIso = thresholdDate.toISOString();

        const activityThreshold = new Date();
        activityThreshold.setMonth(activityThreshold.getMonth() - 3);
        const activityIso = activityThreshold.toISOString();

        // 1. Fetch potentially dormant connections (accepted > 6mo ago)
        const candidates = await step.run("fetch-candidates", async () => {
            return await db
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                })
                .from(connections)
                .where(and(
                    eq(connections.status, 'accepted'),
                    lt(connections.updatedAt, thresholdIso)
                ))
                .limit(1000); 
        });

        if (candidates.length > 0) {
            // 2. Filter for actual dormancy (no shared messages in 3mo)
            const dormantPairs = await step.run("filter-dormancy", async () => {
                const dormantItems: Array<{ userId: string; connectionId: string; targetId: string }> = [];

                for (const conn of candidates) {
                    const low = conn.requesterId < conn.addresseeId ? conn.requesterId : conn.addresseeId;
                    const high = conn.requesterId < conn.addresseeId ? conn.addresseeId : conn.requesterId;

                    const [pair] = await db
                        .select({ conversationId: dmPairs.conversationId })
                        .from(dmPairs)
                        .where(and(eq(dmPairs.userLow, low), eq(dmPairs.userHigh, high)))
                        .limit(1);

                    if (pair) {
                        const [activity] = await db
                            .select({ lastMessageAt: conversationParticipants.lastMessageAt })
                            .from(conversationParticipants)
                            .where(and(
                                eq(conversationParticipants.conversationId, pair.conversationId),
                                gt(conversationParticipants.lastMessageAt, activityThreshold) // Use Date object instead of ISO string
                            ))
                            .limit(1);

                        if (!activity) {
                            dormantItems.push({ userId: conn.requesterId, connectionId: conn.id, targetId: conn.addresseeId });
                            dormantItems.push({ userId: conn.addresseeId, connectionId: conn.id, targetId: conn.requesterId });
                        }
                    } else {
                        // No DM ever started? Definitely dormant.
                        dormantItems.push({ userId: conn.requesterId, connectionId: conn.id, targetId: conn.addresseeId });
                        dormantItems.push({ userId: conn.addresseeId, connectionId: conn.id, targetId: conn.requesterId });
                    }
                }
                return dormantItems;
            });

            // 3. Flag in Redis for UI visibility
            if (dormantPairs.length > 0) {
                await step.run("flag-in-redis", async () => {
                    const redis = getRedisClient();
                    if (!redis) return;

                    const pipeline = redis.pipeline();
                    for (const pair of dormantPairs) {
                        const key = `conn_health:${pair.userId}`;
                        pipeline.sadd(key, pair.targetId);
                        pipeline.expire(key, 60 * 60 * 24 * 7);
                    }
                    await pipeline.exec();
                });
            }
        }

        // 4. Maintenance: Populate username:id cache for Edge Middleware (Batch 5k)
        await step.run("populate-username-cache", async () => {
            const redis = getRedisClient();
            if (!redis) return;

            const activeUsers = await db
                .select({ id: profiles.id, username: profiles.username })
                .from(profiles)
                .where(sql`${profiles.username} IS NOT NULL`)
                .orderBy(sql`${profiles.updatedAt} DESC`)
                .limit(5000);

            const pipeline = redis.pipeline();
            for (const user of activeUsers) {
                if (user.username) {
                    pipeline.set(`username:${user.username}:id`, user.id, { ex: 60 * 60 * 24 * 7 }); // 7 days
                }
            }
            await pipeline.exec();
        });

        return { checked: candidates.length };
    }
);
