import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectNodeLocks, projectNodes } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess, recordNodeEvent } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';

const lockBodySchema = z.object({
    projectId: z.string().uuid(),
    sessionId: z.string().uuid(),
    ttlSeconds: z.number().int().min(10).max(3600).optional().default(120),
});

/**
 * POST /api/v1/files/[nodeId]/lock
 * Acquires a lease lock for a specific file node scoped to the user session.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ nodeId: string }> }
) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const { nodeId } = await context.params;
        const limitResponse = await enforceRouteLimit(request, `api:v1:files:lock:${nodeId}`, 60, 60);
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

        const parsed = lockBodySchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { projectId, sessionId, ttlSeconds } = parsed.data;
        await assertProjectWriteAccess(projectId, user.id);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
        const nowIso = now.toISOString();
        const expiresAtIso = expiresAt.toISOString();

        const result = await db.transaction(async (tx) => {
            // Ensure node exists and belongs to the project
            const node = await tx.query.projectNodes.findFirst({
                where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
                columns: { id: true }
            });
            if (!node) {
                return { success: false, code: 'NOT_FOUND', message: 'File not found' };
            }

            // Acquire or update lock atomically
            const acquiredResult = await tx.execute<{
                nodeId: string;
                projectId: string;
                lockedBy: string;
                sessionId: string;
                expiresAt: string;
            }>(sql`
                INSERT INTO project_node_locks (node_id, project_id, locked_by, session_id, acquired_at, expires_at)
                VALUES (
                    ${nodeId}::uuid,
                    ${projectId}::uuid,
                    ${user.id}::uuid,
                    ${sessionId}::uuid,
                    CAST(${nowIso} AS timestamptz),
                    CAST(${expiresAtIso} AS timestamptz)
                )
                ON CONFLICT (node_id) DO UPDATE
                SET
                    project_id = EXCLUDED.project_id,
                    locked_by = EXCLUDED.locked_by,
                    session_id = EXCLUDED.session_id,
                    acquired_at = EXCLUDED.acquired_at,
                    expires_at = EXCLUDED.expires_at
                WHERE
                    project_node_locks.project_id = EXCLUDED.project_id
                    AND (
                        (project_node_locks.locked_by = EXCLUDED.locked_by AND project_node_locks.session_id = EXCLUDED.session_id)
                        OR project_node_locks.expires_at <= CAST(${nowIso} AS timestamptz)
                    )
                RETURNING
                    node_id AS "nodeId",
                    project_id AS "projectId",
                    locked_by AS "lockedBy",
                    session_id AS "sessionId",
                    expires_at AS "expiresAt"
            `);

            const acquiredRow = Array.from(acquiredResult)[0];
            if (!acquiredRow) {
                // Fetch the existing lock owner to report details
                const existing = await tx.query.projectNodeLocks.findFirst({
                    where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
                });
                return {
                    success: false,
                    code: 'CONFLICT',
                    message: 'File is locked by another collaborator',
                    lock: existing ? {
                        nodeId,
                        projectId,
                        lockedBy: existing.lockedBy,
                        sessionId: existing.sessionId,
                        expiresAt: existing.expiresAt.getTime(),
                    } : null
                };
            }

            // Record lock acquisition event
            await recordNodeEvent(projectId, user.id, nodeId, 'lock_acquire', { expiresAt: expiresAtIso, sessionId }, tx);

            return {
                success: true,
                lock: {
                    nodeId: acquiredRow.nodeId,
                    projectId: acquiredRow.projectId,
                    lockedBy: acquiredRow.lockedBy,
                    sessionId: acquiredRow.sessionId,
                    expiresAt: new Date(acquiredRow.expiresAt).getTime(),
                }
            };
        });

        if (!result.success) {
            return jsonError(result.message || 'Lock acquisition failed', result.code === 'NOT_FOUND' ? 404 : 409, result.code as any, result.lock);
        }

        return jsonSuccess(result.lock);
    } catch (error) {
        console.error('[files/locks/acquire] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
