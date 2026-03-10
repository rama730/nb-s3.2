import { zip, strToU8 } from "fflate";
import type { ProjectNode } from "@/lib/db/schema";

export type DownloadWorkerPayload = {
    jobId: string;
    projectId: string;
    projectName: string;
    nodesById: Record<string, ProjectNode>;
    childrenByParentId: Record<string, string[]>;
    targetFolderId: string | null;
    signedUrls: Record<string, string>;
};

export type DownloadWorkerResult = {
    jobId: string;
    progress?: { loaded: number; total: number; filename: string };
    blob?: Blob;
    error?: string;
};

self.onmessage = async (e: MessageEvent<DownloadWorkerPayload>) => {
    const { jobId, projectName, nodesById, childrenByParentId, targetFolderId, signedUrls } = e.data;

    try {
        const flatFiles: ProjectNode[] = [];
        const walk = (parentId: string | null, currentPath: string) => {
            const childIds = childrenByParentId[parentId === null ? "__root__" : parentId] || [];
            for (const id of childIds) {
                const node = nodesById[id];
                if (!node) continue;
                const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
                if (node.type === "file") {
                    flatFiles.push({ ...node, name: fullPath } as ProjectNode);
                } else if (node.type === "folder") {
                    walk(node.id, fullPath);
                }
            }
        };

        walk(targetFolderId, "");

        if (flatFiles.length === 0) {
            throw new Error("No files found to download.");
        }

        const zipData: Record<string, Uint8Array> = {};
        const totalFiles = flatFiles.length;
        let loadedFiles = 0;

        // Concurrent Download Pool (Throttle at 5 to prevent Chrome socket saturation)
        const CONCURRENCY = 5;
        for (let i = 0; i < flatFiles.length; i += CONCURRENCY) {
            const chunk = flatFiles.slice(i, i + CONCURRENCY);

            await Promise.all(chunk.map(async (file) => {
                try {
                    const url = signedUrls[file.id];
                    if (!url) throw new Error(`Missing signed URL for ${file.name}`);

                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);

                    const arrayBuffer = await response.arrayBuffer();
                    zipData[file.name] = new Uint8Array(arrayBuffer);

                    loadedFiles++;
                    self.postMessage({ jobId, progress: { loaded: loadedFiles, total: totalFiles, filename: file.name } } as DownloadWorkerResult);
                } catch (fetchErr) {
                    console.warn("Failed to download file", { fileName: file.name, error: fetchErr });
                    const safeName = file.name.replace(/\//g, '_');
                    zipData[`_failed_${safeName}.txt`] = strToU8(`Failed to download: ${file.name}\nError: ${fetchErr}`);
                    loadedFiles++;
                    self.postMessage({ jobId, progress: { loaded: loadedFiles, total: totalFiles, filename: `(failed) ${file.name}` } } as DownloadWorkerResult);
                }
            }));
        }

        // Pure WASM Zip Compression on Local CPU
        self.postMessage({ jobId, progress: { loaded: totalFiles, total: totalFiles, filename: "Zipping..." } } as DownloadWorkerResult);

        zip(zipData, { level: 4 }, (err, data) => {
            try {
                if (err) {
                    self.postMessage({ jobId, error: err.message || "Zip compression failed" } as DownloadWorkerResult);
                    return;
                }

                const zipBlob = new Blob([new Uint8Array(data)], { type: "application/zip" });
                self.postMessage({ jobId, blob: zipBlob } as DownloadWorkerResult);
            } catch (callbackErr: any) {
                self.postMessage({
                    jobId,
                    error: callbackErr?.message || "Zip callback failed unexpectedly",
                } as DownloadWorkerResult);
            }
        });

    } catch (err: any) {
        self.postMessage({ jobId, error: err.message || "Unknown zip error" } as DownloadWorkerResult);
    }
};
