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
            const uploadUrl = uploadUrls[node.s3Key];
            if (!uploadUrl) {
                failCount++;
                results.push({ fileId: node.fileId, success: false, error: "Missing signed upload URL" });
                active--;
                self.postMessage({
                    type: "progress",
                    jobId,
                    completed: successCount + failCount,
                    total,
                    success: successCount,
                    failed: failCount
                });
                continue;
            }

            fetch(uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": node.file.type || "application/octet-stream" },
                body: node.file,
            })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`Upload failed (${response.status})`);
                    }
                    successCount++;
                    results.push({ fileId: node.fileId, success: true });
                })
                .catch((error: unknown) => {
                    failCount++;
                    results.push({
                        fileId: node.fileId,
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                })
                .finally(() => {
                    active--;
                    self.postMessage({
                        type: "progress",
                        jobId,
                        completed: successCount + failCount,
                        total,
                        success: successCount,
                        failed: failCount
                    });
                });
        }

        // Wait for trailing active uploads
        while (active > 0) {
            await new Promise((r) => setTimeout(r, 50));
        }

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
