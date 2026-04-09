import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '../../_envelope';
import { enforceRouteLimit, requireAuthenticatedUser } from '../../_shared';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getRedisClient } from '@/lib/redis';
import { validateCsrf } from '@/lib/security/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEBOUNCE_SECONDS = 300; // 5 minutes

export async function POST(request: NextRequest) {
    try {
        const csrfError = await validateCsrf(request);
        if (csrfError) return csrfError;
        const rlResponse = await enforceRouteLimit(request, 'api:v1:presence:heartbeat', 30, 60);
        if (rlResponse) return rlResponse;

        const { user, response } = await requireAuthenticatedUser();
        if (response) return response;
        if (!user) return jsonError('Not authenticated', 401, 'UNAUTHORIZED');

        // Debounce: only update DB if last update was more than 5 minutes ago
        const redis = getRedisClient();
        const debounceKey = `presence:heartbeat:${user.id}`;

        if (redis) {
            const already = await redis.get(debounceKey);
            if (already) {
                return jsonSuccess({ updated: false });
            }
            // Set debounce key with TTL
            await redis.set(debounceKey, '1', { ex: DEBOUNCE_SECONDS });
        }

        // Update last_active_at
        await db
            .update(profiles)
            .set({ lastActiveAt: new Date() })
            .where(eq(profiles.id, user.id));

        return jsonSuccess({ updated: true });
    } catch (error) {
        console.error('Presence heartbeat error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
