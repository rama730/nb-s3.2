'use server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { assertProjectUploadAccess } from '@/lib/files/internal-helpers';
import { isCanonicalProjectFileKey, parseProjectFileKey } from '@/lib/storage/project-file-key';
import { logger } from '@/lib/logger';
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    PROJECT_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';
import { createUploadIntent, createUploadIntents } from '@/lib/upload/upload-intents';

const MAX_BATCH_UPLOAD_KEYS = 200;

const UPLOAD_ERROR_CODES = {
    KEY_FORMAT_INVALID: 'KEY_FORMAT_INVALID',
    UPLOAD_VALIDATION_FAILED: 'UPLOAD_VALIDATION_FAILED',
} as const;

function isUploadValidationError(message: string): boolean {
    return (
        message.includes('MIME type') ||
        message.includes('File size') ||
        message.includes('exceeds maximum size') ||
        message.includes('Relative path')
    );
}

async function assertUploadAccessForKey(key: string, userId: string) {
    const parsed = parseProjectFileKey(key);
    if (!parsed) {
        throw new Error(UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID);
    }
    if (!isCanonicalProjectFileKey(key)) {
        throw new Error(UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID);
    }
    const projectId = parsed.projectId;
    await assertProjectUploadAccess(projectId, userId);
    return projectId;
}

/**
 * Generate a presigned URL for direct browser-to-S3 upload.
 * Pure optimization: zero server throughput, browser uploads directly.
 *
 * @param key - S3 object key (path within bucket)
 * @param contentType - MIME type of the file
 * @returns Presigned URL valid for 1 hour
 */
export async function getUploadPresignedUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    options?: { sessionId?: string | null }
): Promise<{ url: string; uploadIntentId: string; storageKey: string } | { error: string; code?: string }> {
    const startedAt = Date.now();
    try {
        const authClient = await createClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return { error: 'Unauthorized' };
        }

        const projectId = await assertUploadAccessForKey(key, user.id);
        const normalizedMimeType = normalizeAndValidateMimeType(contentType);
        const normalizedSize = normalizeAndValidateFileSize(sizeBytes, PROJECT_UPLOAD_MAX_FILE_BYTES);

        const supabase = await createAdminClient();

        const intent = await createUploadIntent({
            userId: user.id,
            projectId,
            bucket: 'project-files',
            storageKey: key,
            scope: 'project_file',
            kind: 'file',
            expectedMimeType: normalizedMimeType,
            expectedSize: normalizedSize,
            metadata: { sessionId: options?.sessionId ?? null },
        });

        const { data, error } = await supabase.storage
            .from('project-files')
            .createSignedUploadUrl(key, { upsert: true });

        if (error) {
            console.error('Failed to create signed URL:', error);
            return { error: 'Failed to generate upload URL' };
        }

        logger.metric('upload.presign.single', {
            userId: user.id,
            projectId,
            sessionId: options?.sessionId || null,
            contentType: normalizedMimeType,
            sizeBytes: normalizedSize,
            success: 1,
            durationMs: Date.now() - startedAt,
        });

        return { url: data.signedUrl, uploadIntentId: intent.id, storageKey: key };
    } catch (e) {
        if (e instanceof Error && e.message === UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID) {
            return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
        }
        if (e instanceof Error && isUploadValidationError(e.message)) {
            return { error: e.message, code: UPLOAD_ERROR_CODES.UPLOAD_VALIDATION_FAILED };
        }
        console.error('Presigned URL error:', e);
        return { error: 'Internal server error' };
    }
}

/**
 * Batch generate presigned URLs for multiple files.
 * More efficient for folder uploads.
 */
export async function getBatchUploadUrls(
    keys: { key: string; contentType: string; sizeBytes: number }[],
    options?: { sessionId?: string | null }
): Promise<{ urls: Record<string, string>; uploadIntentIds: Record<string, string> } | { error: string; code?: string }> {
    const startedAt = Date.now();
    try {
        const authClient = await createClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return { error: 'Unauthorized' };
        }

        if (!keys || keys.length === 0) {
            return { urls: {}, uploadIntentIds: {} };
        }
        if (keys.length > MAX_BATCH_UPLOAD_KEYS) {
            return { error: `Too many files in one request. Max ${MAX_BATCH_UPLOAD_KEYS}.` };
        }

        const normalizedItems = keys.map((item) => ({
            key: item.key,
            contentType: normalizeAndValidateMimeType(item.contentType),
            sizeBytes: normalizeAndValidateFileSize(item.sizeBytes, PROJECT_UPLOAD_MAX_FILE_BYTES),
        }));

        const firstParsed = parseProjectFileKey(normalizedItems[0]?.key || '');
        if (!firstParsed || !isCanonicalProjectFileKey(normalizedItems[0]?.key || '')) {
            return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
        }
        const firstProjectId = firstParsed.projectId;

        // Ensure all keys belong to the same project
        for (const item of normalizedItems) {
            const parsed = parseProjectFileKey(item.key);
            if (!parsed || !isCanonicalProjectFileKey(item.key) || parsed.projectId !== firstProjectId) {
                return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
            }
        }

        await assertProjectUploadAccess(firstProjectId, user.id);

        const supabase = await createAdminClient();
        const urls: Record<string, string> = {};
        const uploadIntentIds: Record<string, string> = {};

        const intents = await createUploadIntents(normalizedItems.map(({ key, contentType, sizeBytes }) => ({
            userId: user.id,
            projectId: firstProjectId,
            bucket: 'project-files',
            storageKey: key,
            scope: 'project_file',
            kind: 'file',
            expectedMimeType: contentType,
            expectedSize: sizeBytes,
            metadata: { sessionId: options?.sessionId ?? null },
        })));

        const intentIdsByKey = new Map(intents.map(intent => [intent.storageKey, intent.id]));

        const results = await Promise.all(
            normalizedItems.map(async ({ key }) => {
                const intentId = intentIdsByKey.get(key) || '';
                const { data, error } = await supabase.storage
                    .from('project-files')
                    .createSignedUploadUrl(key, { upsert: true });
                return { key, url: data?.signedUrl, error, intentId };
            })
        );

        for (const result of results) {
            if (result.url) {
                urls[result.key] = result.url;
                uploadIntentIds[result.key] = result.intentId;
            }
        }

        logger.metric('upload.presign.batch', {
            userId: user.id,
            projectId: firstProjectId,
            sessionId: options?.sessionId || null,
            requestedCount: normalizedItems.length,
            generatedCount: Object.keys(urls).length,
            durationMs: Date.now() - startedAt,
        });

        return { urls, uploadIntentIds };
    } catch (e) {
        if (e instanceof Error && isUploadValidationError(e.message)) {
            return { error: e.message, code: UPLOAD_ERROR_CODES.UPLOAD_VALIDATION_FAILED };
        }
        console.error('Batch presigned URL error:', e);
        return { error: 'Internal server error' };
    }
}
