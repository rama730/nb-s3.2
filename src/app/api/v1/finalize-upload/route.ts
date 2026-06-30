import { NextRequest } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { uploadIntents, projectNodes, fileVersions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess, recordNodeEvent } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';

const finalizeSchema = z.object({
    uploadIntentId: z.string().uuid(),
    checksum: z.string().length(64), // SHA-256 hex
});

/**
 * POST /api/v1/finalize-upload
 * Finalizes file upload by verifying S3 metadata and committing DB changes.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:finalize-upload', 100, 60);
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

        const parsed = finalizeSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { uploadIntentId, checksum } = parsed.data;

        // 1. Fetch pending upload intent
        const intent = await db.query.uploadIntents.findFirst({
            where: and(eq(uploadIntents.id, uploadIntentId), eq(uploadIntents.status, 'pending')),
        });

        if (!intent) {
            return jsonError('Upload intent not found or already finalized', 404, 'NOT_FOUND');
        }

        if (intent.userId !== user.id) {
            return jsonError('Forbidden', 403, 'FORBIDDEN');
        }

        const projectId = intent.projectId;
        if (!projectId) {
            return jsonError('Invalid project ID on intent', 400, 'BAD_REQUEST');
        }

        await assertProjectWriteAccess(projectId, user.id);

        const intentMetadata = intent.metadata as Record<string, any>;
        const nodeId = intentMetadata.nodeId;
        const parentId = intentMetadata.parentId;
        const path = intentMetadata.path;
        const fileName = intentMetadata.fileName;
        const taskId = intentMetadata.taskId;
        const expectedChecksumHex = intentMetadata.expectedChecksumHex;
        const nextVersion = intentMetadata.nextVersion || 1;

        if (checksum.toLowerCase() !== expectedChecksumHex.toLowerCase()) {
            return jsonError('Checksum mismatch', 400, 'BAD_REQUEST');
        }

        // 2. Query object metadata from Supabase Storage using Admin client
        const adminClient = await createAdminClient();
        const { data: storageInfo, error: storageError } = await adminClient.storage
            .from(intent.bucket)
            .info(intent.storageKey);

        if (storageError || !storageInfo) {
            console.error('[finalize-upload] Storage info error:', storageError);
            return jsonError('Uploaded object not found in storage', 404, 'NOT_FOUND');
        }

        // Validate size matches expected size
        if (storageInfo.size !== intent.expectedSize) {
            return jsonError('File size mismatch', 400, 'BAD_REQUEST');
        }

        // Case-insensitive header checksum extraction from metadata
        const metadata = storageInfo.metadata || {};
        const storageChecksum = (
            metadata['checksum-sha256'] ||
            metadata['checksum_sha256'] ||
            metadata['checksumSha256'] ||
            metadata['x-amz-meta-checksum-sha256'] ||
            metadata['checksum'] ||
            ''
        ).toString();

        if (storageChecksum && storageChecksum.toLowerCase() !== expectedChecksumHex.toLowerCase()) {
            return jsonError('Storage checksum verification failed', 400, 'BAD_REQUEST');
        }

        // 3. Commit DB metadata changes in a single transaction
        const updatedNode = await db.transaction(async (tx) => {
            const existingNode = await tx.query.projectNodes.findFirst({
                where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            });

            let nodeResult;
            if (existingNode) {
                // Update existing node
                [nodeResult] = await tx
                    .update(projectNodes)
                    .set({
                        currentVersion: nextVersion,
                        s3Key: intent.storageKey,
                        size: intent.expectedSize,
                        mimeType: intent.expectedMimeType,
                        gitHash: expectedChecksumHex,
                        syncStatus: taskId ? 'draft' : 'merged', // Staged draft or main merge
                        updatedAt: new Date(),
                    })
                    .where(eq(projectNodes.id, nodeId))
                    .returning();
            } else {
                // Create new node
                [nodeResult] = await tx
                    .insert(projectNodes)
                    .values({
                        id: nodeId,
                        projectId,
                        parentId: parentId || null,
                        taskId: taskId || null,
                        path,
                        type: 'file',
                        name: fileName,
                        s3Key: intent.storageKey,
                        size: intent.expectedSize,
                        mimeType: intent.expectedMimeType,
                        currentVersion: 1,
                        gitHash: expectedChecksumHex,
                        syncStatus: taskId ? 'draft' : 'merged',
                        createdBy: user.id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning();
            }

            // Insert into file_versions
            await tx.insert(fileVersions).values({
                nodeId,
                version: nextVersion,
                s3Key: intent.storageKey,
                size: intent.expectedSize,
                mimeType: intent.expectedMimeType,
                contentHash: expectedChecksumHex,
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

            // Record node event
            const eventType = existingNode ? 'file_write' : 'file_create';
            await recordNodeEvent(projectId, user.id, nodeId, eventType, { version: nextVersion, taskId }, tx);

            return nodeResult;
        });

        return jsonSuccess(updatedNode);
    } catch (error) {
        console.error('[finalize-upload] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
