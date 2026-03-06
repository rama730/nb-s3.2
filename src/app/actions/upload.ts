'use server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { assertProjectWriteAccess } from '@/app/actions/files';
import { isCanonicalProjectFileKey, parseProjectFileKey } from '@/lib/storage/project-file-key';

const MAX_BATCH_UPLOAD_KEYS = 200;

const UPLOAD_ERROR_CODES = {
    KEY_FORMAT_INVALID: 'KEY_FORMAT_INVALID',
} as const;

async function assertUploadAccessForKey(key: string, userId: string) {
    const parsed = parseProjectFileKey(key);
    if (!parsed) {
        throw new Error(UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID);
    }
    if (!isCanonicalProjectFileKey(key)) {
        throw new Error(UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID);
    }
    const projectId = parsed.projectId;
    await assertProjectWriteAccess(projectId, userId);
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
    contentType: string
): Promise<{ url: string } | { error: string; code?: string }> {
    try {
        const authClient = await createClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return { error: 'Unauthorized' };
        }

        await assertUploadAccessForKey(key, user.id);

        const supabase = await createAdminClient();

        const { data, error } = await supabase.storage
            .from('project-files')
            .createSignedUploadUrl(key, { upsert: true });

        if (error) {
            console.error('Failed to create signed URL:', error);
            return { error: 'Failed to generate upload URL' };
        }

        return { url: data.signedUrl };
    } catch (e) {
        if (e instanceof Error && e.message === UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID) {
            return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
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
    keys: { key: string; contentType: string }[]
): Promise<{ urls: Record<string, string> } | { error: string; code?: string }> {
    try {
        const authClient = await createClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return { error: 'Unauthorized' };
        }

        if (!keys || keys.length === 0) {
            return { urls: {} };
        }
        if (keys.length > MAX_BATCH_UPLOAD_KEYS) {
            return { error: `Too many files in one request. Max ${MAX_BATCH_UPLOAD_KEYS}.` };
        }

        const firstParsed = parseProjectFileKey(keys[0]?.key || '');
        if (!firstParsed || !isCanonicalProjectFileKey(keys[0]?.key || '')) {
            return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
        }
        const firstProjectId = firstParsed.projectId;

        // Ensure all keys belong to the same project
        for (const item of keys) {
            const parsed = parseProjectFileKey(item.key);
            if (!parsed || !isCanonicalProjectFileKey(item.key) || parsed.projectId !== firstProjectId) {
                return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
            }
        }

        await assertProjectWriteAccess(firstProjectId, user.id);

        const supabase = await createAdminClient();
        const urls: Record<string, string> = {};

        // Process in parallel batches of 10
        const BATCH_SIZE = 10;
        for (let i = 0; i < keys.length; i += BATCH_SIZE) {
            const batch = keys.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
                batch.map(async ({ key }) => {
                    const { data, error } = await supabase.storage
                        .from('project-files')
                        .createSignedUploadUrl(key, { upsert: true });
                    return { key, url: data?.signedUrl, error };
                })
            );

            for (const result of results) {
                if (result.url) {
                    urls[result.key] = result.url;
                }
            }
        }

        return { urls };
    } catch (e) {
        console.error('Batch presigned URL error:', e);
        return { error: 'Internal server error' };
    }
}
