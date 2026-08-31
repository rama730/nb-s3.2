import { db } from '@/lib/db';
import { connections, profiles } from '@/lib/db/schema';
import { sql, inArray, eq, and, or } from 'drizzle-orm';
import { redis } from '@/lib/redis';
import { revalidatePath } from 'next/cache';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function applyConnectionsCountIncrements(tx: DbTransaction, increments: Map<string, number>) {
    if (increments.size === 0) return;
    const entries = [...increments.entries()].filter(([, value]) => value !== 0);
    if (entries.length === 0) return;

    const ids = entries.map(([id]) => id);
    const cases = sql.join(
        entries.map(([id, value]) => sql`WHEN ${profiles.id} = ${id} THEN ${value}`),
        sql` `,
    );

    await tx
        .update(profiles)
        .set({
            connectionsCount: sql`GREATEST(0, ${profiles.connectionsCount} + CASE ${cases} ELSE 0 END)`,
            updatedAt: new Date(),
        })
        .where(inArray(profiles.id, ids));
}

export async function revalidateConnectionsPaths() {
    revalidatePath('/people');
    revalidatePath('/profile');
    revalidatePath('/messages');
}

async function invalidateDiscoverCacheForUser(userId: string) {
    const redisClient = redis;
    if (!redisClient) return;
    try {
        const patterns = [
            `discover:profile:${userId}:*`,
            `connections:inbox_cache:${userId}:*`,
        ];

        for (const pattern of patterns) {
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redisClient.scan(cursor, {
                    match: pattern,
                    count: 100,
                });
                cursor = nextCursor;

                for (let index = 0; index < keys.length; index += 100) {
                    const batch = keys.slice(index, index + 100);
                    if (batch.length > 0) {
                        await Promise.all(batch.map((key) => redisClient.unlink(key)));
                    }
                }
            } while (cursor !== '0');
        }
    } catch (error) {
        console.error('Failed to invalidate discover and inbox cache:', error);
    }
}

export async function invalidateDiscoverCacheForUsers(userIds: Iterable<string | null | undefined>) {
    const uniqueUserIds = Array.from(
        new Set(
            Array.from(userIds).filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
        ),
    );
    if (uniqueUserIds.length === 0) return;
    await Promise.allSettled(uniqueUserIds.map((userId) => invalidateDiscoverCacheForUser(userId))).catch(console.error);
}

export async function syncConnectionsToRedis(userId: string) {
    const redisClient = redis;
    if (!redisClient) return;
    try {
        const key = `user:${userId}:connections`;
        const accepted = await db
            .select({
                otherId: sql<string>`CASE 
                    WHEN ${connections.requesterId} = ${userId} THEN ${connections.addresseeId} 
                    ELSE ${connections.requesterId} 
                END`
            })
            .from(connections)
            .where(and(
                eq(connections.status, 'accepted'),
                or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId))
            ));
        
        const otherIds = accepted.map(row => row.otherId);
        
        const pipeline = redisClient.pipeline();
        pipeline.del(key);
        if (otherIds.length > 0) {
            for (const otherId of otherIds) {
                pipeline.sadd(key, otherId);
            }
            pipeline.expire(key, 86400); // 24h cache duration
        }
        await pipeline.exec();
    } catch (error) {
        console.error('Failed to sync connections to Redis:', error);
    }
}

export async function applyConnectionPairsToRedis(
    rows: Array<{ requesterId: string; addresseeId: string }>,
    operation: 'add' | 'remove',
) {
    if (!redis || rows.length === 0) return;
    const uniquePairs = new Map<string, { requesterId: string; addresseeId: string }>();
    for (const row of rows) {
        const key = row.requesterId < row.addresseeId
            ? `${row.requesterId}:${row.addresseeId}`
            : `${row.addresseeId}:${row.requesterId}`;
        uniquePairs.set(key, row);
    }

    const peersByKey = new Map<string, Set<string>>();
    for (const { requesterId, addresseeId } of uniquePairs.values()) {
        const requesterKey = `user:${requesterId}:connections`;
        const addresseeKey = `user:${addresseeId}:connections`;
        const requesterPeers = peersByKey.get(requesterKey) ?? new Set<string>();
        requesterPeers.add(addresseeId);
        peersByKey.set(requesterKey, requesterPeers);
        const addresseePeers = peersByKey.get(addresseeKey) ?? new Set<string>();
        addresseePeers.add(requesterId);
        peersByKey.set(addresseeKey, addresseePeers);
    }

    // A missing set means "unknown" and must stay missing so readers use the
    // database fallback instead of mistaking one incremental pair for a full graph.
    const keys = [...peersByKey.keys()];
    const existencePipeline = redis.pipeline();
    for (const key of keys) existencePipeline.exists(key);
    const existence = await existencePipeline.exec() as unknown[];

    const pipeline = redis.pipeline();
    let mutationCount = 0;
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        if (Number(existence[index] ?? 0) !== 1) continue;
        const peers = [...(peersByKey.get(key) ?? [])];
        if (peers.length === 0) continue;
        if (operation === 'add') {
            for (const peer of peers) pipeline.sadd(key, peer);
            pipeline.expire(key, 86400);
            mutationCount += peers.length + 1;
        } else {
            for (const peer of peers) pipeline.srem(key, peer);
            mutationCount += peers.length;
        }
    }
    if (mutationCount > 0) await pipeline.exec();
}
