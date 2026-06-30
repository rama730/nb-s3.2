import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectNodeLocks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';

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
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, "api:v1:files:locks:release", 60, 60);
        if (limitResponse) return limitResponse;

        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError('Invalid JSON', 400, 'BAD_REQUEST');
        }

        const releaseSchema = z.object({
            projectId: z.string().uuid(),
            nodeIds: z.array(z.string().min(1)).max(100),
            sessionId: z.string().uuid().optional(),
        });

        const parsed = releaseSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { projectId, nodeIds: validNodeIds, sessionId } = parsed.data;
        await assertProjectWriteAccess(projectId, user.id);

        if (validNodeIds.length === 0) {
            return jsonSuccess(null, 'No locks to release');
        }

        const conditions = [
            eq(projectNodeLocks.projectId, projectId),
            eq(projectNodeLocks.lockedBy, user.id),
            inArray(projectNodeLocks.nodeId, validNodeIds),
        ];

        if (sessionId) {
            conditions.push(eq(projectNodeLocks.sessionId, sessionId));
        }

        await db.delete(projectNodeLocks).where(and(...conditions));

        return jsonSuccess(null, `Released ${validNodeIds.length} lock(s)`);
    } catch (error) {
        console.error('[files/locks/release] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
