import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/app/api/v1/_envelope';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getRedisClient } from '@/lib/redis';
import { validateCsrf } from '@/lib/security/csrf';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEBOUNCE_SECONDS = 300; // 5 minutes
const localHeartbeatDebounce = new Map<string, number>();

function shouldUseRedisPresenceHeartbeat() {
    const mode = (process.env.PRESENCE_STORE_MODE || process.env.PRESENCE_TRANSPORT || '').trim().toLowerCase();
    return process.env.NODE_ENV === 'production' || mode === 'redis';
}

function isLocallyDebounced(key: string) {
    const now = Date.now();
    const existing = localHeartbeatDebounce.get(key);
    if (existing && existing > now) return true;

    if (localHeartbeatDebounce.size > 5_000) {
        for (const [entryKey, expiresAt] of localHeartbeatDebounce.entries()) {
            if (expiresAt <= now) localHeartbeatDebounce.delete(entryKey);
        }
    }

    localHeartbeatDebounce.set(key, now + DEBOUNCE_SECONDS * 1000);
    return false;
}

export async function POST(request: NextRequest) {
    try {
        const csrfError = await validateCsrf(request);
        if (csrfError) return csrfError;
        const rlResponse = await enforceRouteLimit(request, 'api:v1:presence:heartbeat', 30, 60);
        if (rlResponse) return rlResponse;

        const auth = await getViewerAuthContext();
        if (!auth.userId || !auth.user) return jsonError('Not authenticated', 401, 'UNAUTHORIZED');

        const sessionId = auth.snapshot?.sessionId ?? null;
        if (!sessionId) {
            return jsonSuccess({ updated: false });
        }

        // Debounce: only update DB if last update was more than 5 minutes ago
        const liveSessionKey = `presence:live-session:${auth.userId}:${sessionId}`;
        const debounceKey = `presence:heartbeat:${auth.userId}:${sessionId}`;

        if (shouldUseRedisPresenceHeartbeat()) {
            const redis = getRedisClient();
            if (!redis) {
                return jsonSuccess({ updated: false });
            }
            const liveSession = await redis.get(liveSessionKey);
            if (!liveSession) {
                return jsonSuccess({ updated: false });
            }
            const already = await redis.get(debounceKey);
            if (already) {
                return jsonSuccess({ updated: false });
            }
            // Set debounce key with TTL
            await redis.set(debounceKey, '1', { ex: DEBOUNCE_SECONDS });
        } else if (isLocallyDebounced(debounceKey)) {
            return jsonSuccess({ updated: false });
        }

        // Update last_active_at
        await db
            .update(profiles)
            .set({ lastActiveAt: new Date() })
            .where(eq(profiles.id, auth.userId));

        return jsonSuccess({ updated: true });
    } catch (error) {
        console.error('Presence heartbeat error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
