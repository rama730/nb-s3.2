import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectNodeLocks } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';

const renewBodySchema = z.object({
    projectId: z.string().uuid(),
    sessionId: z.string().uuid(),
    ttlSeconds: z.number().int().min(10).max(3600).optional().default(120),
});

/**
 * POST /api/v1/files/[nodeId]/lock-renew
 * Heartbeat endpoint extending lock lease TTL for an active session.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ nodeId: string }> }
) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const { nodeId } = await context.params;
        const limitResponse = await enforceRouteLimit(request, `api:v1:files:lock-renew:${nodeId}`, 120, 60);
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

        const parsed = renewBodySchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { projectId, sessionId, ttlSeconds } = parsed.data;
        await assertProjectWriteAccess(projectId, user.id);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

        const result = await db.transaction(async (tx) => {
            const existing = await tx.query.projectNodeLocks.findFirst({
                where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
            });

            if (!existing) {
                return { success: false, code: 'NOT_FOUND', message: 'Lock not found' };
            }

            if (existing.lockedBy !== user.id || existing.sessionId !== sessionId) {
                return { success: false, code: 'FORBIDDEN', message: 'Lock is owned by another session or user' };
            }

            await tx.update(projectNodeLocks)
                .set({ expiresAt })
                .where(and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)));

            return { success: true, expiresAt: expiresAt.getTime() };
        });

        if (!result.success) {
            return jsonError(result.message || 'Renewal failed', result.code === 'NOT_FOUND' ? 404 : 403, result.code as any);
        }

        return jsonSuccess({ expiresAt: result.expiresAt });
    } catch (error) {
        console.error('[files/locks/renew] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
