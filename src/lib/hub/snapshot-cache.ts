import { createHash } from 'crypto';

interface CacheEntry<T> {
    expiresAt: number;
    value: T;
}

const SNAPSHOT_CACHE_MAX_ITEMS = 300;
const snapshotCache = new Map<string, CacheEntry<unknown>>();

const pruneIfNeeded = () => {
    if (snapshotCache.size <= SNAPSHOT_CACHE_MAX_ITEMS) return;

    const now = Date.now();
    for (const [key, entry] of snapshotCache) {
        if (entry.expiresAt <= now) {
            snapshotCache.delete(key);
        }
    }

    if (snapshotCache.size <= SNAPSHOT_CACHE_MAX_ITEMS) return;

    const sorted = Array.from(snapshotCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const overflow = snapshotCache.size - SNAPSHOT_CACHE_MAX_ITEMS;
    for (let i = 0; i < overflow; i += 1) {
        const item = sorted[i];
        if (item) snapshotCache.delete(item[0]);
    }
};

export function buildHubSnapshotKey(input: unknown): string {
    const serialized = JSON.stringify(input);
    return createHash('sha1').update(serialized).digest('hex');
}

export async function getHubSnapshotCached<T>(
    cacheKey: string,
    ttlSeconds: number,
    compute: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
    const now = Date.now();
    const existing = snapshotCache.get(cacheKey) as CacheEntry<T> | undefined;

    if (existing && existing.expiresAt > now) {
        return { value: existing.value, cacheHit: true };
    }

    const computed = await compute();
    snapshotCache.set(cacheKey, {
        value: computed,
        expiresAt: now + ttlSeconds * 1000,
    });

    pruneIfNeeded();
    return { value: computed, cacheHit: false };
}
