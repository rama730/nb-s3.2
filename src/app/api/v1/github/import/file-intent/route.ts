import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles, uploadIntents } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const fileIntentSchema = z.object({
    jobId: z.string().uuid(),
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    checksum: z.string().length(64), // SHA-256 hex
});

/**
 * POST /api/v1/github/import/file-intent
 * Pre-registers file upload intent for an active import job, returning a signed upload URL.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:file-intent', 200, 60);
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

        const parsed = fileIntentSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { jobId, path, size, mimeType, checksum } = parsed.data;

        // Fetch job to check access
        const job = await db.query.importJobs.findFirst({
            where: and(eq(importJobs.id, jobId), eq(importJobs.status, 'importing')),
        });

        if (!job) {
            return jsonError('Import job not active or not found', 404, 'NOT_FOUND');
        }

        await assertProjectWriteAccess(job.projectId, user.id);

        // Fetch the file state from import_job_files
        const jobFile = await db.query.importJobFiles.findFirst({
            where: and(
                eq(importJobFiles.jobId, jobId),
                eq(importJobFiles.path, path)
            ),
        });

        if (!jobFile) {
            return jsonError('File path not registered in job manifest', 404, 'NOT_FOUND');
        }

        const fileId = randomUUID();
        const storageKey = `imports/${jobId}/files/${fileId}-${checksum}`;
        const bucket = 'project-files';

        const adminClient = await createAdminClient();
        const { data: uploadSession, error: storageError } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(storageKey);

        if (storageError || !uploadSession) {
            console.error('[github-import-file-intent] signed URL generation failed:', storageError);
            return jsonError('Failed to generate signed upload URL', 500, 'INTERNAL_ERROR');
        }

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

        const result = await db.transaction(async (tx) => {
            // Insert upload intent
            const [intent] = await tx
                .insert(uploadIntents)
                .values({
                    userId: user.id,
                    projectId: job.projectId,
                    bucket,
                    storageKey,
                    scope: 'project_file',
                    kind: 'file',
                    expectedMimeType: mimeType,
                    expectedSize: size,
                    status: 'pending',
                    expiresAt,
                    metadata: {
                        jobId,
                        path,
                        checksum,
                        fileId,
                    },
                })
                .returning();

            if (!intent) {
                throw new Error("Failed to insert upload intent");
            }

            // Update file status in import_job_files
            await tx
                .update(importJobFiles)
                .set({
                    status: 'uploading',
                    uploadIntentId: intent.id,
                    s3Key: storageKey,
                })
                .where(eq(importJobFiles.id, jobFile.id));

            return intent;
        });

        return jsonSuccess({
            uploadIntentId: result.id,
            signedUrl: uploadSession.signedUrl,
            storagePath: storageKey,
        });
    } catch (error) {
        console.error('[github-import-file-intent] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
