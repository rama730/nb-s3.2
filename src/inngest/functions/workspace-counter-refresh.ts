import { inngest } from '../client';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { refreshWorkspaceCountersForUsers } from '@/lib/workspace/profile-counters';

export const workspaceCountersRefresh = inngest.createFunction(
    { 
        id: 'workspace-counters-refresh', 
        name: 'Workspace Counters Refresh',
        batchEvents: {
            maxSize: 100,
            timeout: '5s',
        },
    },
    { event: 'workspace/counters.refresh' },
    async ({ events, step }) => {
        const userIds = [...new Set(events.map(e => e.data.userId))];
        
        await step.run('refresh-counters', async () => {
            // Remove from dirty set first to allow new refreshes to be queued
            const redis = getRedisClient();
            if (redis) {
                await redis.srem('profile_counters:dirty_users', ...userIds);
            }

            // Perform batched refresh
            await refreshWorkspaceCountersForUsers(db, userIds);
        });

        return {
            processed: userIds.length,
        };
    }
);
