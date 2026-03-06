import { createClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";

self.onmessage = async (e: MessageEvent) => {
    const { uploadNodes, supabaseUrl, supabaseAnonKey, bucketName, jwt } = e.data as {
        uploadNodes: { file: File; s3Key: string; fileId: string; path: string }[];
        supabaseUrl: string;
        supabaseAnonKey: string;
        bucketName: string;
        jwt: string; // The user's auth token
    };

    if (!uploadNodes || uploadNodes.length === 0) {
        self.postMessage({ type: "done", success: 0, failed: 0 });
        return;
    }

    // Create a custom supabase client using the provided URL, Key, and JWT
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${jwt}`
            }
        }
    });

    const MAX_CONCURRENCY = 5;
    let active = 0;
    let cursor = 0;
    let successCount = 0;
    let failCount = 0;
    const total = uploadNodes.length;

    const results: { fileId: string; success: boolean; error?: string }[] = [];

    const pump = async () => {
        while (cursor < total) {
            if (active >= MAX_CONCURRENCY) {
                await new Promise((r) => setTimeout(r, 50));
                continue;
            }

            const node = uploadNodes[cursor++];
            active++;

            const upload = new tus.Upload(node.file, {
                endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
                retryDelays: [0, 3000, 5000, 10000, 20000],
                headers: {
                    Authorization: `Bearer ${jwt}`,
                    'x-upsert': 'true',
                },
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                metadata: {
                    bucketName: bucketName,
                    objectName: node.s3Key,
                    contentType: node.file.type || 'application/octet-stream',
                    cacheControl: '3600',
                },
                chunkSize: 6 * 1024 * 1024, // 6MB
                onError: (error) => {
                    failCount++;
                    results.push({ fileId: node.fileId, success: false, error: error.message });
                    active--;
                    self.postMessage({
                        type: "progress",
                        completed: successCount + failCount,
                        total,
                        success: successCount,
                        failed: failCount
                    });
                },
                onSuccess: () => {
                    successCount++;
                    results.push({ fileId: node.fileId, success: true });
                    active--;
                    self.postMessage({
                        type: "progress",
                        completed: successCount + failCount,
                        total,
                        success: successCount,
                        failed: failCount
                    });
                }
            });

            // For extreme bulk uploads, we bypass checking for previous partial uploads and force start
            upload.start();
        }

        // Wait for trailing active uploads
        while (active > 0) {
            await new Promise((r) => setTimeout(r, 50));
        }

        self.postMessage({
            type: "done",
            success: successCount,
            failed: failCount,
            results
        });
    };

    pump();
};
