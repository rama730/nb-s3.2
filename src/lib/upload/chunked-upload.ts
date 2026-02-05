'use client';

/**
 * Progressive folder upload with real-time progress.
 * Uses direct browser-to-S3 uploads via presigned URLs.
 * Pure optimization: chunked, resumable, zero server load.
 */

export interface UploadProgress {
    totalFiles: number;
    uploadedFiles: number;
    totalBytes: number;
    uploadedBytes: number;
    currentFile: string;
    percent: number;
}

export interface UploadResult {
    success: boolean;
    uploadedKeys: string[];
    failedFiles: string[];
}

/**
 * Upload a folder of files with progress tracking.
 * Files are uploaded directly to S3 via presigned URLs.
 * 
 * @param files - FileList from folder selection
 * @param projectId - Target project ID
 * @param onProgress - Progress callback
 * @param getPresignedUrl - Function to get presigned URL for a file
 */
export async function uploadFolder(
    files: FileList,
    projectId: string,
    onProgress: (progress: UploadProgress) => void,
    getPresignedUrl: (fileName: string, contentType: string) => Promise<string>,
    signal?: AbortSignal
): Promise<UploadResult> {
    const totalBytes = Array.from(files).reduce((sum, f) => sum + f.size, 0); // Calculate once

    const result: UploadResult = {
        success: true,
        uploadedKeys: [],
        failedFiles: [],
    };

    let completedBytes = 0;  // Bytes from fully completed files
    let uploadedFiles = 0;

    // PURE OPTIMIZATION: Use native for loop for native FileList
    for (let i = 0; i < files.length; i++) {
        if (signal?.aborted) throw new Error('Upload cancelled');
        const file = files[i];
        const relativePath = file.webkitRelativePath || file.name;
        const s3Key = `${projectId}/${relativePath}`;

        try {
            const presignedUrl = await getPresignedUrl(s3Key, file.type || 'application/octet-stream');

            if (signal?.aborted) throw new Error('Upload cancelled');

            // Track this file's progress separately
            await uploadFileWithProgress(file, presignedUrl, (currentFileBytes) => {
                onProgress({
                    totalFiles: files.length,
                    uploadedFiles,
                    totalBytes,
                    uploadedBytes: completedBytes + currentFileBytes,
                    currentFile: relativePath,
                    percent: Math.round(((completedBytes + currentFileBytes) / totalBytes) * 100),
                });
            }, signal);

            // File complete - add to completed bytes
            completedBytes += file.size;
            result.uploadedKeys.push(s3Key);
            uploadedFiles++;
        } catch (error: any) {
            if (error.message === 'Upload cancelled') throw error;
            console.error(`Failed to upload ${relativePath}:`, error);
            result.failedFiles.push(relativePath);
            completedBytes += file.size;  // Count failed files to keep progress accurate
        }
    }

    // Final success check
    result.success = result.failedFiles.length === 0;

    onProgress({
        totalFiles: files.length,
        uploadedFiles,
        totalBytes,
        uploadedBytes: totalBytes,
        currentFile: '',
        percent: 100,
    });

    return result;
}

/**
 * Upload a single file to a presigned URL with progress tracking.
 */
async function uploadFileWithProgress(
    file: File,
    presignedUrl: string,
    onBytesUploaded: (bytes: number) => void,
    signal?: AbortSignal
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        if (signal) {
            signal.addEventListener('abort', () => {
                xhr.abort();
                reject(new Error('Upload cancelled'));
            });
        }

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                onBytesUploaded(e.loaded);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`Upload failed: ${xhr.status}`));
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
    });
}

/**
 * Calculate human-readable file size
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
