import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/app/api/v1/_envelope';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { isTransientDbError, readDbErrorCode, withDbRetry } from '@/lib/db/retry';
import { profiles } from '@/lib/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { getRedisClient } from '@/lib/redis';
import { validateCsrf } from '@/lib/security/csrf';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEBOUNCE_SECONDS = 300; // 5 minutes
const localHeartbeatDebounce = new Map<string, number>();

function shouldUseRedisPresenceHeartbeat() {
    return process.env.NODE_ENV === 'production';
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

        const userId = auth.userId;
        const sessionId = auth.snapshot?.sessionId ?? null;
        if (!sessionId) {
            return jsonSuccess({ updated: false });
        }

        // Debounce: only update DB if last update was more than 5 minutes ago
        const debounceKey = `presence:heartbeat:${auth.userId}:${sessionId}`;

        if (shouldUseRedisPresenceHeartbeat()) {
            const redis = getRedisClient();
            if (!redis) {
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

        try {
            await withDbRetry("presence.heartbeat.last_active", async () => {
                const staleBefore = new Date(Date.now() - DEBOUNCE_SECONDS * 1000);
                await db
                    .update(profiles)
                    .set({ lastActiveAt: new Date() })
                    .where(and(
                        eq(profiles.id, userId),
                        or(isNull(profiles.lastActiveAt), lt(profiles.lastActiveAt, staleBefore)),
                    ));
            }, { module: "presence" });
        } catch (error) {
            if (isTransientDbError(error)) {
                logger.warn("presence.heartbeat_last_active_skipped", {
                    module: "presence",
                    userId,
                    sessionId,
                    errorCode: readDbErrorCode(error),
                    error: error instanceof Error ? error.message : String(error),
                });
                return jsonSuccess({ updated: false, skipped: "transient_db" });
            }
            throw error;
        }

        return jsonSuccess({ updated: true });
    } catch (error) {
        console.error('Presence heartbeat error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
