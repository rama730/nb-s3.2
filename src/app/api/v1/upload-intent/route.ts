import { NextRequest } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { uploadIntents, projectNodes } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const uploadIntentSchema = z.object({
    projectId: z.string().uuid(),
    nodeId: z.string().uuid().optional(),
    fileName: z.string().min(1),
    parentId: z.string().uuid().nullable().optional(),
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    taskId: z.string().uuid().nullable().optional(),
    expectedChecksumHex: z.string().length(64), // SHA-256 hex
    expectedChecksumBase64: z.string().min(1),  // SHA-256 base64 for S3 header validation
});

/**
 * POST /api/v1/upload-intent
 * Pre-registers a file upload intent, returning a signed Supabase Storage URL.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:upload-intent', 100, 60);
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

        const parsed = uploadIntentSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const {
            projectId,
            nodeId,
            fileName,
            parentId,
            path,
            size,
            mimeType,
            taskId,
            expectedChecksumHex,
            expectedChecksumBase64,
        } = parsed.data;

        await assertProjectWriteAccess(projectId, user.id);

        const activeNodeId = nodeId || randomUUID();
        let nextVersion = 1;

        if (nodeId) {
            const existingNode = await db.query.projectNodes.findFirst({
                where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
                columns: { currentVersion: true }
            });
            if (existingNode) {
                nextVersion = existingNode.currentVersion + 1;
            }
        }

        // Key layout: projects/{projectId}/nodes/{nodeId}/versions/{versionNumber}-{contentHash}
        const storageKey = `projects/${projectId}/nodes/${activeNodeId}/versions/${nextVersion}-${expectedChecksumHex}`;
        const bucket = 'project-files';

        // Generate signed upload URL from Supabase Storage Admin Client
        const adminClient = await createAdminClient();
        const { data: uploadSession, error: storageError } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(storageKey);

        if (storageError || !uploadSession) {
            console.error('[upload-intent] Storage signed url error:', storageError);
            return jsonError('Failed to generate signed upload URL', 500, 'INTERNAL_ERROR');
        }

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

        const [intent] = await db
            .insert(uploadIntents)
            .values({
                userId: user.id,
                projectId,
                bucket,
                storageKey,
                scope: 'project_file',
                kind: 'file',
                expectedMimeType: mimeType,
                expectedSize: size,
                status: 'pending',
                expiresAt,
                metadata: {
                    nodeId: activeNodeId,
                    parentId: parentId || null,
                    path,
                    fileName,
                    taskId: taskId || null,
                    expectedChecksumHex,
                    expectedChecksumBase64,
                    nextVersion,
                },
            })
            .returning();

        if (!intent) {
            return jsonError('Failed to register upload intent', 500, 'INTERNAL_ERROR');
        }

        return jsonSuccess({
            uploadIntentId: intent.id,
            signedUrl: uploadSession.signedUrl,
            storagePath: storageKey,
            token: uploadSession.token, // for clients using manual client PUTs
        });
    } catch (error) {
        console.error('[upload-intent] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
