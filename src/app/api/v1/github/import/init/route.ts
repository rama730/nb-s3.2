import { NextRequest } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs } from '@/lib/db/schema';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const initSchema = z.object({
    projectId: z.string().uuid(),
    manifestHash: z.string().length(64), // SHA-256 hex
    totalFiles: z.number().int().nonnegative(),
});

/**
 * POST /api/v1/github/import/init
 * Initializes repository ingestion, returning a signed upload URL for the manifest.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:init', 100, 60);
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

        const parsed = initSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { projectId, manifestHash, totalFiles } = parsed.data;
        await assertProjectWriteAccess(projectId, user.id);

        const jobId = randomUUID();
        const manifestS3Key = `imports/${jobId}/manifest.json`;
        const bucket = 'project-files';

        // Generate signed URL for manifest upload
        const adminClient = await createAdminClient();
        const { data: uploadSession, error: storageError } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(manifestS3Key);

        if (storageError || !uploadSession) {
            console.error('[github-import-init] Storage signed url error:', storageError);
            return jsonError('Failed to generate signed manifest URL', 500, 'INTERNAL_ERROR');
        }

        // Insert pending import job
        const [job] = await db
            .insert(importJobs)
            .values({
                id: jobId,
                projectId,
                status: 'pending',
                totalFiles,
                processedFiles: 0,
                manifestS3Key,
                manifestHash,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        if (!job) {
            return jsonError('Failed to initialize import job', 500, 'INTERNAL_ERROR');
        }

        return jsonSuccess({
            jobId: job.id,
            signedUrl: uploadSession.signedUrl,
            manifestS3Key,
        });
    } catch (error) {
        console.error('[github-import-init] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
