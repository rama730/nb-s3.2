'use server';

import { createAdminClient } from '@/lib/supabase/server';

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
): Promise<{ url: string } | { error: string }> {
    try {
        const supabase = await createAdminClient();

        const { data, error } = await supabase.storage
            .from('project-files')
            .createSignedUploadUrl(key);

        if (error) {
            console.error('Failed to create signed URL:', error);
            return { error: 'Failed to generate upload URL' };
        }

        return { url: data.signedUrl };
    } catch (e) {
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
): Promise<{ urls: Record<string, string> } | { error: string }> {
    try {
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
                        .createSignedUploadUrl(key);
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
