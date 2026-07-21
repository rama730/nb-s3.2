import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles, uploadIntents } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';

const abortSchema = z.object({
    jobId: z.string().uuid(),
});

/**
 * POST /api/v1/github/import/abort
 * Aborts an active import job, marking it failed, and cleaning up any uploaded file blobs.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:abort', 100, 60);
        if (limitResponse) return limitResponse;

        const auth = await requireAuthenticatedUser();
        if (auth.response || !auth.user) return auth.response ?? jsonError('Unauthorized', 401, 'UNAUTHORIZED');
        const user = auth.user;

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError('Invalid JSON', 400, 'BAD_REQUEST');
        }

        const parsed = abortSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { jobId } = parsed.data;

        // 1. Fetch import job
        const job = await db.query.importJobs.findFirst({
            where: eq(importJobs.id, jobId),
        });

        if (!job) {
            return jsonError('Import job not found', 404, 'NOT_FOUND');
        }

        if (job.status === 'completed' || job.status === 'failed') {
            return jsonError(`Cannot abort import job that is already in '${job.status}' state`, 400, 'BAD_REQUEST');
        }

        await assertProjectWriteAccess(job.projectId, user.id);

        // 2. Fetch all files for this job that might have S3 objects
        const filesWithKeys = await db.query.importJobFiles.findMany({
            where: eq(importJobFiles.jobId, jobId),
            columns: {
                id: true,
                s3Key: true,
                uploadIntentId: true,
            },
        });

        const keysToDelete: string[] = [];
        const intentIds: string[] = [];

        if (job.manifestS3Key) {
            keysToDelete.push(job.manifestS3Key);
        }

        for (const f of filesWithKeys) {
            if (f.s3Key) {
                keysToDelete.push(f.s3Key);
            }
            if (f.uploadIntentId) {
                intentIds.push(f.uploadIntentId);
            }
        }

        // 3. Delete from Supabase Storage
        if (keysToDelete.length > 0) {
            const adminClient = await createAdminClient();
            const { error: storageDeleteError } = await adminClient.storage
                .from('project-files')
                .remove(keysToDelete);
            
            if (storageDeleteError) {
                console.error('[github-import-abort] Failed to delete S3 objects during abort:', storageDeleteError);
            }
        }

        // 4. Update database statuses inside transaction
        await db.transaction(async (tx) => {
            // Mark job as failed
            await tx
                .update(importJobs)
                .set({
                    status: 'failed',
                    errorMessage: 'Import aborted by user',
                    updatedAt: new Date(),
                })
                .where(eq(importJobs.id, jobId));

            // Mark job files as failed
            await tx
                .update(importJobFiles)
                .set({
                    status: 'failed',
                    errorMessage: 'Import aborted',
                })
                .where(eq(importJobFiles.jobId, jobId));

            // Mark upload intents as failed
            if (intentIds.length > 0) {
                await tx
                    .update(uploadIntents)
                    .set({
                        status: 'failed',
                        failureReason: 'Import aborted by user',
                        updatedAt: new Date(),
                    })
                    .where(inArray(uploadIntents.id, intentIds));
            }
        });

        return jsonSuccess({
            message: 'Import job aborted successfully and resources cleaned up',
            jobId,
        });
    } catch (error) {
        console.error('[github-import-abort] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
