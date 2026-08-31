import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles, uploadIntents, projectNodes, fileVersions } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess, recordNodeEvent } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { createDirectoryStructureFromPaths } from '@/lib/import/utils';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import path from 'path';

const finalizeFileSchema = z.object({
    jobId: z.string().uuid(),
    path: z.string().min(1),
    uploadIntentId: z.string().uuid(),
});

/**
 * POST /api/v1/github/import/finalize-file
 * Finalizes file upload for ingestion job by checking storage info, updating the DB node/version,
 * and marking import_job_files status as completed.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:finalize-file', 300, 60);
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

        const parsed = finalizeFileSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { jobId, path: filePath, uploadIntentId } = parsed.data;

        // 1. Fetch import job
        const job = await db.query.importJobs.findFirst({
            where: and(eq(importJobs.id, jobId), eq(importJobs.status, 'importing')),
        });
        if (!job) {
            return jsonError('Active import job not found', 404, 'NOT_FOUND');
        }

        await assertProjectWriteAccess(job.projectId, user.id);

        // 2. Fetch upload intent
        const intent = await db.query.uploadIntents.findFirst({
            where: and(eq(uploadIntents.id, uploadIntentId), eq(uploadIntents.status, 'pending')),
        });
        if (!intent) {
            return jsonError('Pending upload intent not found', 404, 'NOT_FOUND');
        }
        if (intent.userId !== user.id || intent.projectId !== job.projectId) {
            return jsonError('Forbidden', 403, 'FORBIDDEN');
        }

        // 3. Fetch import job file record
        const jobFile = await db.query.importJobFiles.findFirst({
            where: and(
                eq(importJobFiles.jobId, jobId),
                eq(importJobFiles.path, filePath)
            ),
        });
        if (!jobFile) {
            return jsonError('File path not registered in job manifest', 404, 'NOT_FOUND');
        }
        if (jobFile.status === 'completed') {
            return jsonSuccess({ message: 'File already finalized', nodeId: jobFile.id });
        }

        // 4. Query object metadata from storage
        const adminClient = await createAdminClient();
        const { data: storageInfo, error: storageError } = await adminClient.storage
            .from(intent.bucket)
            .info(intent.storageKey);

        if (storageError || !storageInfo) {
            console.error('[finalize-file] Storage info error:', storageError);
            return jsonError('Uploaded object not found in storage', 404, 'NOT_FOUND');
        }

        if (storageInfo.size !== intent.expectedSize) {
            return jsonError('File size mismatch with expected intent size', 400, 'BAD_REQUEST');
        }

        // 5. Ensure folder structure exists
        const rel = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
        const dir = path.posix.dirname(rel);
        const fileName = path.posix.basename(rel);

        let parentId: string | null = null;
        if (dir && dir !== '.') {
            const parts = dir.split('/');
            const dirPaths = new Set<string>();
            let current = '';
            for (const part of parts) {
                current = current ? `${current}/${part}` : part;
                dirPaths.add(current);
            }
            const folderMap = await createDirectoryStructureFromPaths(job.projectId, dirPaths, user.id);
            parentId = folderMap.get(dir) || null;
        }

        const nodePath = `/${rel}`;

        // 6. Commit node and version changes in a transaction
        const result = await db.transaction(async (tx) => {
            // Check if node already exists (matching path in project)
            const existingNode = await tx.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.projectId, job.projectId),
                    eq(projectNodes.path, nodePath),
                    isNull(projectNodes.deletedAt)
                ),
            });

            const nodeId = existingNode?.id || randomUUID();
            const nextVersion = existingNode ? existingNode.currentVersion + 1 : 1;

            if (existingNode) {
                await tx
                    .update(projectNodes)
                    .set({
                        currentVersion: nextVersion,
                        s3Key: intent.storageKey,
                        size: intent.expectedSize,
                        mimeType: intent.expectedMimeType,
                        gitHash: jobFile.checksum,
                        syncStatus: 'merged',
                        updatedAt: new Date(),
                    })
                    .where(eq(projectNodes.id, existingNode.id));
            } else {
                await tx
                    .insert(projectNodes)
                    .values({
                        id: nodeId,
                        projectId: job.projectId,
                        parentId,
                        path: nodePath,
                        type: 'file',
                        name: fileName,
                        s3Key: intent.storageKey,
                        size: intent.expectedSize,
                        mimeType: intent.expectedMimeType,
                        currentVersion: 1,
                        gitHash: jobFile.checksum,
                        syncStatus: 'merged',
                        createdBy: user.id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
            }

            // Create file version record
            await tx.insert(fileVersions).values({
                nodeId,
                version: nextVersion,
                s3Key: intent.storageKey,
                size: intent.expectedSize,
                mimeType: intent.expectedMimeType,
                contentHash: jobFile.checksum,
                uploadedBy: user.id,
                uploadedAt: new Date(),
            });

            // Mark upload intent as finalized
            await tx
                .update(uploadIntents)
                .set({
                    status: 'finalized',
                    finalizedMimeType: intent.expectedMimeType,
                    finalizedSize: intent.expectedSize,
                    finalizedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(uploadIntents.id, uploadIntentId));

            // Mark import job file as completed
            await tx
                .update(importJobFiles)
                .set({
                    status: 'completed',
                    finalizedAt: new Date(),
                })
                .where(eq(importJobFiles.id, jobFile.id));

            // Increment processedFiles in import job
            const updatedJob = await tx
                .update(importJobs)
                .set({
                    processedFiles: job.processedFiles + 1,
                    updatedAt: new Date(),
                })
                .where(eq(importJobs.id, jobId))
                .returning();

            // If job is finished, update status
            const currentProcessed = updatedJob[0]?.processedFiles || (job.processedFiles + 1);
            if (currentProcessed >= job.totalFiles) {
                await tx
                    .update(importJobs)
                    .set({
                        status: 'completed',
                        updatedAt: new Date(),
                    })
                    .where(eq(importJobs.id, jobId));
            }

            // Record node event
            const eventType = existingNode ? 'file_write' : 'file_create';
            await recordNodeEvent(job.projectId, user.id, nodeId, eventType, { version: nextVersion }, tx);

            return { nodeId, nextVersion, isComplete: currentProcessed >= job.totalFiles };
        });

        return jsonSuccess({
            message: 'File import finalized successfully',
            nodeId: result.nodeId,
            version: result.nextVersion,
            isComplete: result.isComplete,
        });
    } catch (error) {
        console.error('[github-import-finalize-file] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
