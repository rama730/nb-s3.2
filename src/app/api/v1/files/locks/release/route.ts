import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectNodeLocks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';

/**
 * POST /api/v1/files/locks/release
 * Releases locks held by the current user. Designed to be called via
 * `navigator.sendBeacon()` on tab/window close so orphan locks don't
 * block collaborators for the full 2-minute TTL.
 *
 * Body: { projectId: string, nodeIds: string[] }
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body.projectId !== 'string' || !Array.isArray(body.nodeIds)) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { projectId, nodeIds } = body as { projectId: string; nodeIds: string[] };
        const validNodeIds = nodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100);
        if (validNodeIds.length === 0) {
            return jsonSuccess(null, 'No locks to release');
        }

        await db.delete(projectNodeLocks).where(
            and(
                eq(projectNodeLocks.projectId, projectId),
                eq(projectNodeLocks.lockedBy, user.id),
                inArray(projectNodeLocks.nodeId, validNodeIds),
            ),
        );

        return jsonSuccess(null, `Released ${validNodeIds.length} lock(s)`);
    } catch (error) {
        console.error('[files/locks/release] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
