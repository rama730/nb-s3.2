import { and, eq, or, gt, inArray } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db";
import { profiles, connections, projectMembers, conversationParticipants, dmPairs } from "@/lib/db/schema";
import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";

/**
 * Compute Active Connections — Runs every 30 minutes to identify
 * "active" connections for recently active users.
 *
 * A pair is "active" if it is already an accepted connection (see `acceptedPairSet`)
 * and either:
 *   1. Both users are members of the same project, OR
 *   2. They have exchanged messages in the last 30 days
 *
 * Results are stored in Redis Sets with a 1-hour TTL for fast lookup.
 */
export const computeActiveConnections = inngest.createFunction(
    { id: "compute-active-connections", retries: 1 },
    { cron: "*/30 * * * *" }, // Every 30 minutes
    async ({ step }) => {
        const redis = getRedisClient();
        if (!redis) return { processed: 0 };

        const BATCH_SIZE = 100;
        let totalProcessed = 0;
        let offset = 0;
        let hasMore = true;

        const activityThreshold = new Date();
        activityThreshold.setHours(activityThreshold.getHours() - 24);

        const messageThreshold = new Date();
        messageThreshold.setDate(messageThreshold.getDate() - 30);

        while (hasMore) {
            const batchUsers = await step.run(`fetch-active-users-${offset}`, async () => {
                return await db
                    .select({ id: profiles.id })
                    .from(profiles)
                    .where(gt(profiles.lastActiveAt, activityThreshold))
                    .orderBy(profiles.id)
                    .limit(BATCH_SIZE)
                    .offset(offset);
            });

            if (batchUsers.length === 0) {
                hasMore = false;
                break;
            }

            const userIds = batchUsers.map(u => u.id);

            await step.run(`compute-batch-${offset}`, async () => {
                // 1. Fetch the projects that batch users belong to, then all members on those projects.
                const userMemberships = await db
                    .select({ userId: projectMembers.userId, projectId: projectMembers.projectId })
                    .from(projectMembers)
                    .where(inArray(projectMembers.userId, userIds));
                const projectIds = [...new Set(userMemberships.map((membership) => membership.projectId))];
                const allMemberships = projectIds.length > 0
                    ? await db
                        .select({ userId: projectMembers.userId, projectId: projectMembers.projectId })
                        .from(projectMembers)
                        .where(inArray(projectMembers.projectId, projectIds))
                    : [];

                // Build user -> projectIds and project -> userIds maps
                const userProjectMap = new Map<string, Set<string>>();
                const projectUserMap = new Map<string, Set<string>>();
                for (const m of userMemberships) {
                    if (!userProjectMap.has(m.userId)) userProjectMap.set(m.userId, new Set());
                    userProjectMap.get(m.userId)!.add(m.projectId);
                }
                for (const m of allMemberships) {
                    if (!projectUserMap.has(m.projectId)) projectUserMap.set(m.projectId, new Set());
                    projectUserMap.get(m.projectId)!.add(m.userId);
                }

                // 2. Fetch all recent DM activity for the batch in one query
                const allRecentDms = await db
                    .select({
                        participantUserId: conversationParticipants.userId,
                        userLow: dmPairs.userLow,
                        userHigh: dmPairs.userHigh,
                    })
                    .from(dmPairs)
                    .innerJoin(
                        conversationParticipants,
                        and(
                            eq(conversationParticipants.conversationId, dmPairs.conversationId),
                            inArray(conversationParticipants.userId, userIds),
                            gt(conversationParticipants.lastMessageAt, messageThreshold)
                        )
                    )
                    .where(or(
                        inArray(dmPairs.userLow, userIds),
                        inArray(dmPairs.userHigh, userIds)
                    ));

                // Build user -> dm partner set
                const userDmPartnerMap = new Map<string, Set<string>>();
                for (const dm of allRecentDms) {
                    const userId = dm.participantUserId;
                    const otherId = dm.userLow === userId ? dm.userHigh : dm.userLow;
                    if (!userDmPartnerMap.has(userId)) userDmPartnerMap.set(userId, new Set());
                    userDmPartnerMap.get(userId)!.add(otherId);
                }

                // 3. Fetch all accepted connections involving batch users in one query
                const allAccepted = await db
                    .select({
                        requesterId: connections.requesterId,
                        addresseeId: connections.addresseeId,
                    })
                    .from(connections)
                    .where(and(
                        eq(connections.status, 'accepted'),
                        or(
                            inArray(connections.requesterId, userIds),
                            inArray(connections.addresseeId, userIds)
                        )
                    ));

                // Build a set of accepted connection pairs for fast lookup
                const acceptedPairSet = new Set<string>();
                for (const c of allAccepted) {
                    acceptedPairSet.add(`${c.requesterId}:${c.addresseeId}`);
                    acceptedPairSet.add(`${c.addresseeId}:${c.requesterId}`);
                }

                // 4. Build active sets per user and write to Redis
                for (const userId of userIds) {
                    const activeSet = new Set<string>();

                    // Co-project members who are accepted connections
                    const myProjects = userProjectMap.get(userId);
                    if (myProjects) {
                        for (const pId of myProjects) {
                            const members = projectUserMap.get(pId);
                            if (members) {
                                for (const mId of members) {
                                    if (mId !== userId && acceptedPairSet.has(`${userId}:${mId}`)) {
                                        activeSet.add(mId);
                                    }
                                }
                            }
                        }
                    }

                    // DM partners who are accepted connections
                    const dmPartners = userDmPartnerMap.get(userId);
                    if (dmPartners) {
                        for (const dId of dmPartners) {
                            if (acceptedPairSet.has(`${userId}:${dId}`)) {
                                activeSet.add(dId);
                            }
                        }
                    }

                    // Store in Redis Set with 1-hour TTL
                    const key = `active_connections:${userId}`;
                    if (activeSet.size > 0) {
                        const pipeline = redis.pipeline();
                        pipeline.del(key);
                        for (const memberId of activeSet) {
                            pipeline.sadd(key, memberId);
                        }
                        pipeline.expire(key, 3600);
                        const results = await pipeline.exec();
                        let pipelineError: Error | null = null;
                        if (Array.isArray(results)) {
                            for (const result of results) {
                                if (!Array.isArray(result) || result.length === 0) continue;
                                const [error] = result;
                                if (error instanceof Error) {
                                    pipelineError = error;
                                    break;
                                }
                                if (error) {
                                    pipelineError = new Error(String(error));
                                    break;
                                }
                            }
                        }
                        if (pipelineError) {
                            logger.error("active-connections.redis.pipeline_failed", {
                                module: "active-connections",
                                userId,
                                key,
                                error: pipelineError.message,
                            });
                            throw pipelineError;
                        }
                    } else {
                        await redis.del(key);
                    }
                }
            });

            totalProcessed += batchUsers.length;
            offset += BATCH_SIZE;

            if (batchUsers.length < BATCH_SIZE) {
                hasMore = false;
            }
        }

        return { processed: totalProcessed };
    }
);
