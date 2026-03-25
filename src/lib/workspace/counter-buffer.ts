import { inngest } from '@/inngest/client';
import { getRedisClient } from '@/lib/redis';

/**
 * Queues a counter refresh for a specific user.
 * This is the high-scale entry point for all counter updates.
 * Instead of recalculating immediately, it adds the user to a "dirty" set
 * and triggers an Inngest background job to handle batching and debouncing.
 */
export async function queueCounterRefresh(userId: string) {
    const redis = getRedisClient();
    if (!redis) {
        // Fallback: If Redis is down, we still want the refresh, but it won't be as efficient/deduplicated.
        await inngest.send({
            name: "workspace/counters.refresh",
            data: { userId },
        });
        return;
    }

    const alreadyQueued = await redis.sadd('profile_counters:dirty_users', userId);

    // Non-blocking background trigger: wrap in try-catch to ensure resiliency
    // Accepting a connection is more critical than the counter UI update.
    try {
        if (alreadyQueued > 0) {
            await inngest.send({
                name: "workspace/counters.refresh",
                data: { userId },
            });
        }
    } catch (err) {
        console.warn(`[counter-buffer] Inngest trigger failed for ${userId}:`, err instanceof Error ? err.message : String(err));
        // We don't re-throw here because we want the calling action to succeed.
        // The reconciliation cron will eventually fix any drifted counters.
    }
}

/**
 * Best-effort version of counter refresh.
 * Swallows all errors and processes multiple user IDs.
 */
export async function queueCounterRefreshBestEffort(userIds: (string | null)[]) {
    try {
        const validIds = userIds.filter((id): id is string => id !== null);
        if (validIds.length === 0) return;

        for (const userId of validIds) {
            await queueCounterRefresh(userId);
        }
    } catch (err) {
        console.warn(`[counter-buffer] Best-effort refresh failed:`, err instanceof Error ? err.message : String(err));
    }
}
