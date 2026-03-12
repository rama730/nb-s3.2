'use client';

import { buildProjectFileKey } from '@/lib/storage/project-file-key';

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

export interface UploadFolderOptions {
    signal?: AbortSignal;
    sessionId?: string;
    manifestHash?: string;
    retryBudget?: number;
    maxConcurrency?: number;
    alreadyUploadedKeys?: Iterable<string>;
}

type UploadTask = {
    file: File;
    relativePath: string;
    s3Key: string;
};

const LARGE_FILE_BYTES = 20 * 1024 * 1024;
const MEDIUM_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MIN_CONCURRENCY = 2;
const DEFAULT_MAX_CONCURRENCY = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveUploadOptions(signalOrOptions?: AbortSignal | UploadFolderOptions): UploadFolderOptions {
    if (!signalOrOptions) return {};
    if (signalOrOptions instanceof AbortSignal) {
        return { signal: signalOrOptions };
    }
    return signalOrOptions;
}

function detectAdaptiveConcurrency(): number {
    let base = 5;
    if (typeof navigator !== 'undefined') {
        const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
        const effectiveType = nav.connection?.effectiveType || '';
        if (effectiveType.includes('2g')) base = 2;
        else if (effectiveType.includes('3g')) base = 3;
        else if (effectiveType.includes('4g')) base = 6;
        if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0) {
            base = Math.min(base, Math.max(2, Math.floor(navigator.hardwareConcurrency / 2)));
        }
    }
    return Math.min(DEFAULT_MAX_CONCURRENCY, Math.max(DEFAULT_MIN_CONCURRENCY, base));
}

function getFileMaxAttempts(fileSize: number): number {
    if (fileSize >= LARGE_FILE_BYTES) return 2;
    if (fileSize >= MEDIUM_FILE_BYTES) return 3;
    return 4;
}

function computeBackoffMs(attempt: number): number {
    const jitter = Math.floor(Math.random() * 150);
    return Math.min(1500, 200 * attempt * attempt + jitter);
}

function createTasks(files: FileList, projectId: string): UploadTask[] {
    const tasks: UploadTask[] = [];
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const relativePath = file.webkitRelativePath || file.name;
        tasks.push({
            file,
            relativePath,
            s3Key: buildProjectFileKey(projectId, relativePath),
        });
    }
    // Upload larger files first so tail latency is lower and retries are front-loaded.
    tasks.sort((a, b) => b.file.size - a.file.size);
    return tasks;
}

/**
 * Upload a folder of files with adaptive bounded concurrency and deterministic retry budget.
 * Backward compatible:
 * - previous signature accepted AbortSignal as the last argument
 * - current signature also accepts UploadFolderOptions
 */
export async function uploadFolder(
    files: FileList,
    projectId: string,
    onProgress: (progress: UploadProgress) => void,
    getPresignedUrl: (fileName: string, contentType: string, sizeBytes: number) => Promise<string>,
    signalOrOptions?: AbortSignal | UploadFolderOptions,
): Promise<UploadResult> {
    const options = resolveUploadOptions(signalOrOptions);
    const signal = options.signal;
    const totalBytes = Array.from(files).reduce((sum, file) => sum + file.size, 0);
    const tasks = createTasks(files, projectId);
    const uploadedKeysFromResume = new Set(options.alreadyUploadedKeys || []);
    const queuedTasks = tasks.filter((task) => !uploadedKeysFromResume.has(task.s3Key));
    const result: UploadResult = {
        success: true,
        uploadedKeys: Array.from(uploadedKeysFromResume),
        failedFiles: [],
    };

    if (tasks.length === 0) {
        onProgress({
            totalFiles: 0,
            uploadedFiles: 0,
            totalBytes: 0,
            uploadedBytes: 0,
            currentFile: '',
            percent: 100,
        });
        return result;
    }

    let completedBytes = tasks
        .filter((task) => uploadedKeysFromResume.has(task.s3Key))
        .reduce((sum, task) => sum + task.file.size, 0);
    let uploadedFiles = uploadedKeysFromResume.size;
    let retryBudget = Number.isFinite(options.retryBudget)
        ? Math.max(0, Math.floor(options.retryBudget!))
        : Math.max(8, Math.ceil(tasks.length * 0.25));
    const inFlightBytes = new Map<string, number>();
    let currentFile = '';

    const emitProgress = () => {
        const inFlightTotal = Array.from(inFlightBytes.values()).reduce((sum, v) => sum + v, 0);
        const uploadedBytes = Math.min(totalBytes, completedBytes + inFlightTotal);
        onProgress({
            totalFiles: tasks.length,
            uploadedFiles,
            totalBytes,
            uploadedBytes,
            currentFile,
            percent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100,
        });
    };

    const concurrency = Math.min(
        Math.max(1, options.maxConcurrency || detectAdaptiveConcurrency()),
        Math.max(1, queuedTasks.length),
    );
    let cursor = 0;

    const runTask = async (task: UploadTask) => {
        if (signal?.aborted) throw new Error('Upload cancelled');

        let attempt = 0;
        const maxAttempts = getFileMaxAttempts(task.file.size);
        while (true) {
            if (signal?.aborted) throw new Error('Upload cancelled');
            currentFile = task.relativePath;
            emitProgress();

            try {
                const presignedUrl = await getPresignedUrl(
                    task.s3Key,
                    task.file.type || 'application/octet-stream',
                    task.file.size,
                );
                if (signal?.aborted) throw new Error('Upload cancelled');

                await uploadFileWithProgress(
                    task.file,
                    presignedUrl,
                    (uploaded) => {
                        inFlightBytes.set(task.s3Key, uploaded);
                        currentFile = task.relativePath;
                        emitProgress();
                    },
                    signal,
                );

                inFlightBytes.delete(task.s3Key);
                completedBytes += task.file.size;
                uploadedFiles += 1;
                result.uploadedKeys.push(task.s3Key);
                emitProgress();
                return;
            } catch (error: any) {
                inFlightBytes.delete(task.s3Key);
                if (error?.message === 'Upload cancelled' || signal?.aborted) {
                    throw new Error('Upload cancelled');
                }

                const canRetry = attempt + 1 < maxAttempts && retryBudget > 0;
                if (canRetry) {
                    attempt += 1;
                    retryBudget -= 1;
                    await sleep(computeBackoffMs(attempt));
                    continue;
                }

                console.error('Failed to upload file', {
                    relativePath: task.relativePath,
                    sessionId: options.sessionId || null,
                    manifestHash: options.manifestHash || null,
                    error,
                });
                result.failedFiles.push(task.relativePath);
                emitProgress();
                return;
            }
        }
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= queuedTasks.length) return;
            await runTask(queuedTasks[index]);
        }
    });

    await Promise.all(workers);

    result.success = result.failedFiles.length === 0;
    const finalUploadedBytes = Math.min(totalBytes, completedBytes);
    onProgress({
        totalFiles: tasks.length,
        uploadedFiles,
        totalBytes,
        uploadedBytes: finalUploadedBytes,
        currentFile: '',
        percent: totalBytes > 0 ? Math.round((finalUploadedBytes / totalBytes) * 100) : 100,
    });

    return result;
}

async function uploadFileWithProgress(
    file: File,
    presignedUrl: string,
    onBytesUploaded: (bytes: number) => void,
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let settled = false;
        let onAbort: (() => void) | null = null;

        const cleanupAbortListener = () => {
            if (signal && onAbort) {
                signal.removeEventListener('abort', onAbort);
            }
            onAbort = null;
        };

        const resolveOnce = () => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            resolve();
        };

        const rejectOnce = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            reject(error);
        };

        if (signal) {
            onAbort = () => {
                xhr.abort();
                rejectOnce(new Error('Upload cancelled'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) {
                onAbort();
                return;
            }
        }

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
                onBytesUploaded(event.loaded);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolveOnce();
            } else {
                rejectOnce(new Error(`Upload failed: ${xhr.status}`));
            }
        });

        xhr.addEventListener('error', () => rejectOnce(new Error('Upload failed')));
        xhr.addEventListener('abort', () => rejectOnce(new Error('Upload cancelled')));

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
    });
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
