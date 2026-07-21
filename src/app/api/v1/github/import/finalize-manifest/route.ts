import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { createHash } from 'crypto';

const finalizeSchema = z.object({
    jobId: z.string().uuid(),
    manifestHash: z.string().length(64),
});

interface ManifestFile {
    path: string;
    size: number;
    checksum: string;
}

/**
 * POST /api/v1/github/import/finalize-manifest
 * Verifies manifest upload, downloads it from S3, validates the hash, and inserts import_job_files rows.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:finalize-manifest', 100, 60);
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

        const parsed = finalizeSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { jobId, manifestHash } = parsed.data;

        // 1. Fetch import job
        const job = await db.query.importJobs.findFirst({
            where: and(eq(importJobs.id, jobId), eq(importJobs.status, 'pending')),
        });

        if (!job) {
            return jsonError('Import job not found or already verified', 404, 'NOT_FOUND');
        }

        await assertProjectWriteAccess(job.projectId, user.id);

        if (job.manifestHash !== manifestHash || !job.manifestS3Key) {
            return jsonError('Manifest hash mismatch or key is missing', 400, 'BAD_REQUEST');
        }

        // 2. Download manifest from S3
        const adminClient = await createAdminClient();
        const { data: manifestBlob, error: downloadError } = await adminClient.storage
            .from('project-files')
            .download(job.manifestS3Key);

        if (downloadError || !manifestBlob) {
            console.error('[finalize-manifest] Download manifest error:', downloadError);
            return jsonError('Failed to download manifest from storage', 404, 'NOT_FOUND');
        }

        const manifestText = await manifestBlob.text();

        // 3. Verify manifest checksum
        const computedHash = createHash('sha256').update(manifestText).digest('hex');
        if (computedHash.toLowerCase() !== manifestHash.toLowerCase()) {
            return jsonError('Downloaded manifest checksum mismatch', 400, 'BAD_REQUEST');
        }

        let manifestData;
        try {
            manifestData = JSON.parse(manifestText);
        } catch {
            return jsonError('Manifest contains invalid JSON', 400, 'BAD_REQUEST');
        }

        const manifestFiles = manifestData.files as ManifestFile[];
        if (!Array.isArray(manifestFiles)) {
            return jsonError('Manifest structure is invalid (missing files array)', 400, 'BAD_REQUEST');
        }

        // 4. Batch insert files into import_job_files in a single transaction
        await db.transaction(async (tx) => {
            // Update job status to 'importing'
            await tx
                .update(importJobs)
                .set({
                    status: 'importing',
                    updatedAt: new Date(),
                })
                .where(eq(importJobs.id, jobId));

            // Chunk inserts to prevent SQL limit issues on large batches
            const chunkSize = 200;
            for (let i = 0; i < manifestFiles.length; i += chunkSize) {
                const chunk = manifestFiles.slice(i, i + chunkSize);
                const values = chunk.map((file) => ({
                    jobId,
                    path: file.path,
                    size: file.size,
                    checksum: file.checksum,
                    status: 'pending',
                    createdAt: new Date(),
                }));
                await tx.insert(importJobFiles).values(values);
            }
        });

        return jsonSuccess({
            jobId,
            status: 'importing',
            filesCount: manifestFiles.length,
        });
    } catch (error) {
        console.error('[github-import-finalize-manifest] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
