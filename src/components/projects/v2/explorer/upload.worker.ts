self.onmessage = async (e: MessageEvent) => {
    const { uploadNodes, uploadUrls, jobId } = e.data as {
        uploadNodes: { file: File; s3Key: string; fileId: string; path: string }[];
        uploadUrls: Record<string, string>;
        jobId?: string;
    };

    if (!uploadNodes || uploadNodes.length === 0) {
        self.postMessage({ type: "done", success: 0, failed: 0, jobId });
        return;
    }

    const MAX_CONCURRENCY = 5;
    let cursor = 0;
    let successCount = 0;
    let failCount = 0;
    const total = uploadNodes.length;

    const results: { fileId: string; success: boolean; error?: string }[] = [];

    const pump = async () => {
        const uploadNext = async (): Promise<void> => {
            if (cursor >= total) return;
            const nodeIdx = cursor++;
            if (nodeIdx >= total) return;
            const node = uploadNodes[nodeIdx];
            if (!node) return uploadNext();

            const uploadUrl = uploadUrls[node.s3Key];
            if (!uploadUrl) {
                failCount++;
                results.push({ fileId: node.fileId, success: false, error: "Missing signed upload URL" });
                self.postMessage({
                    type: "progress",
                    jobId,
                    completed: successCount + failCount,
                    total,
                    success: successCount,
                    failed: failCount
                });
                return uploadNext();
            }

            let attempt = 0;
            const maxAttempts = 3;
            let uploadSuccess = false;
            let lastError: unknown = null;

            while (attempt < maxAttempts) {
                try {
                    const response = await fetch(uploadUrl, {
                        method: "PUT",
                        headers: { "Content-Type": node.file.type || "application/octet-stream" },
                        body: node.file,
                    });
                    if (!response.ok) {
                        throw new Error(`Upload failed (${response.status})`);
                    }
                    uploadSuccess = true;
                    break;
                } catch (error: unknown) {
                    attempt++;
                    lastError = error;
                    if (attempt < maxAttempts) {
                        const delay = Math.pow(2, attempt) * 500;
                        await new Promise((resolve) => setTimeout(resolve, delay));
                    }
                }
            }

            if (uploadSuccess) {
                successCount++;
                results.push({ fileId: node.fileId, success: true });
            } else {
                failCount++;
                results.push({
                    fileId: node.fileId,
                    success: false,
                    error: lastError instanceof Error ? lastError.message : String(lastError),
                });
            }

            self.postMessage({
                type: "progress",
                jobId,
                fileId: node.fileId,
                fileSucceeded: uploadSuccess,
                completed: successCount + failCount,
                total,
                success: successCount,
                failed: failCount
            });

            return uploadNext();
        };

        const workers = Array.from(
            { length: Math.min(MAX_CONCURRENCY, total) },
            () => uploadNext()
        );
        await Promise.all(workers);

        self.postMessage({
            type: "done",
            jobId,
            success: successCount,
            failed: failCount,
            results
        });
    };

    pump().catch((err) => {
        self.postMessage({
            type: "error",
            jobId,
            message: err?.message || "Upload failed unexpectedly",
        });
    });
};
