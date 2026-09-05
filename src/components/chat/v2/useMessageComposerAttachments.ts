'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelAttachmentUpload, uploadAttachment, type UploadedAttachment } from '@/app/actions/messaging';
import { compressImage, generateTinyThumbnail } from '@/lib/messages/image-compression';
import { readMediaDimensions, type MediaDimensions } from '@/lib/messages/media-metadata';
import {
    MAX_UPLOAD_RETRIES,
    type PendingAttachment,
} from './message-composer-v2-shared';

const MAX_ATTACHMENTS = 12;
const UPLOAD_CONCURRENCY = 3;
const COMPRESSION_CONCURRENCY = 2;

interface PreparedAttachmentFile {
    file: File;
    dimensions: MediaDimensions | null;
    tinyBase64?: string;
}

interface UseMessageComposerAttachmentsParams {
    conversationId: string;
    onAddFiles?: (register: (files: File[]) => void) => void;
}

function createPendingAttachment({ file, dimensions, tinyBase64 }: PreparedAttachmentFile): PendingAttachment {
    return {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: (file.type.startsWith('image/') || file.type.startsWith('video/')) ? URL.createObjectURL(file) : undefined,
        status: 'queued',
        progress: 0,
        attempts: 0,
        width: dimensions?.width,
        height: dimensions?.height,
        tinyBase64: file.type.startsWith('image/') ? tinyBase64 : undefined,
    };
}

function releaseAttachmentPreview(attachment: Pick<PendingAttachment, 'preview'>) {
    if (attachment.preview) {
        URL.revokeObjectURL(attachment.preview);
    }
}

async function compressFilesWithLimit(files: File[], concurrency: number) {
    const results = new Array<PreparedAttachmentFile>(files.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < files.length) {
            const index = nextIndex;
            nextIndex += 1;
            const file = await compressImage(files[index]!);
            const tinyBase64 = await generateTinyThumbnail(file) || undefined;
            results[index] = {
                file,
                dimensions: await readMediaDimensions(file),
                tinyBase64,
            };
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
    );

    return results;
}

export function useMessageComposerAttachments({
    conversationId,
    onAddFiles,
}: UseMessageComposerAttachmentsParams) {
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const attachmentsRef = useRef<PendingAttachment[]>([]);
    const activeUploadIdsRef = useRef<Set<string>>(new Set());
    const pendingAttachmentReservationsRef = useRef(0);
    const conversationEpochRef = useRef(0);
    const startQueuedUploadsRef = useRef<() => void>(() => undefined);

    const reserveAttachmentSlots = useCallback((requestedCount: number) => {
        if (requestedCount <= 0) {
            return 0;
        }
        const availableSlots = Math.max(
            0,
            MAX_ATTACHMENTS - attachmentsRef.current.length - pendingAttachmentReservationsRef.current,
        );
        const reservedCount = Math.min(requestedCount, availableSlots);
        pendingAttachmentReservationsRef.current += reservedCount;
        return reservedCount;
    }, []);

    const releaseAttachmentSlots = useCallback((releasedCount: number) => {
        if (releasedCount <= 0) {
            return;
        }
        pendingAttachmentReservationsRef.current = Math.max(
            0,
            pendingAttachmentReservationsRef.current - releasedCount,
        );
    }, []);

    const stagePreparedAttachments = useCallback((
        preparedFiles: PreparedAttachmentFile[],
        reservedCount: number,
        epoch: number,
    ) => {
        const boundedCount = Math.min(
            reservedCount,
            preparedFiles.length,
            Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length),
        );
        const nextItems = preparedFiles.slice(0, boundedCount).map(createPendingAttachment);
        releaseAttachmentSlots(reservedCount);

        if (nextItems.length === 0) {
            return 0;
        }

        const stagedIds = new Set(nextItems.map((attachment) => attachment.id));
        attachmentsRef.current = [...attachmentsRef.current, ...nextItems];

        setAttachments((prev) => {
            if (conversationEpochRef.current !== epoch) {
                attachmentsRef.current = attachmentsRef.current.filter((attachment) => !stagedIds.has(attachment.id));
                nextItems.forEach(releaseAttachmentPreview);
                return prev;
            }

            const availableSlots = Math.max(0, MAX_ATTACHMENTS - prev.length);
            const appendCount = Math.min(nextItems.length, availableSlots);
            const finalItems = nextItems.slice(0, appendCount);
            const skippedItems = nextItems.slice(appendCount);

            if (skippedItems.length > 0) {
                const skippedIds = new Set(skippedItems.map((attachment) => attachment.id));
                attachmentsRef.current = attachmentsRef.current.filter((attachment) => !skippedIds.has(attachment.id));
                skippedItems.forEach(releaseAttachmentPreview);
            }

            return finalItems.length > 0
                ? [...prev, ...finalItems]
                : prev;
        });

        startQueuedUploadsRef.current();
        return nextItems.length;
    }, [releaseAttachmentSlots]);

    const enqueueFiles = useCallback(async (files: File[]) => {
        const reservedCount = reserveAttachmentSlots(files.length);
        if (reservedCount === 0) {
            return false;
        }

        const epoch = conversationEpochRef.current;
        const targetFiles = files.slice(0, reservedCount);

        // Frame 0: Immediately stage files with local object URLs so chips render in 0ms!
        const initialPrepared: PreparedAttachmentFile[] = targetFiles.map((file) => ({
            file,
            dimensions: null,
            tinyBase64: undefined,
        }));
        stagePreparedAttachments(initialPrepared, reservedCount, epoch);

        // Background: concurrently run image compression & dimensions per file without blocking UI
        void Promise.all(
            targetFiles.map(async (file) => {
                try {
                    const compressed = await compressImage(file);
                    const dimensions = await readMediaDimensions(compressed);
                    const tinyBase64 = (await generateTinyThumbnail(compressed)) || undefined;
                    if (conversationEpochRef.current !== epoch) return;
                    setAttachments((prev) =>
                        prev.map((item) =>
                            item.file === file
                                ? {
                                    ...item,
                                    file: compressed,
                                    width: dimensions?.width ?? item.width,
                                    height: dimensions?.height ?? item.height,
                                    tinyBase64: tinyBase64 ?? item.tinyBase64,
                                }
                                : item,
                        ),
                    );
                } catch (error) {
                    console.error('Failed background file preparation:', error);
                }
            }),
        );
        return true;
    }, [reserveAttachmentSlots, stagePreparedAttachments]);

    const enqueuePastedImage = useCallback(async (file: File) => {
        const reservedCount = reserveAttachmentSlots(1);
        if (reservedCount === 0) {
            return false;
        }

        const epoch = conversationEpochRef.current;
        stagePreparedAttachments([{ file, dimensions: null, tinyBase64: undefined }], reservedCount, epoch);

        try {
            const compressedFile = await compressImage(file);
            const dimensions = await readMediaDimensions(compressedFile);
            const tinyBase64 = (await generateTinyThumbnail(compressedFile)) || undefined;
            if (conversationEpochRef.current !== epoch) {
                return false;
            }
            setAttachments((prev) =>
                prev.map((item) =>
                    item.file === file
                        ? {
                            ...item,
                            file: compressedFile,
                            width: dimensions?.width ?? item.width,
                            height: dimensions?.height ?? item.height,
                            tinyBase64: tinyBase64 ?? item.tinyBase64,
                        }
                        : item,
                ),
            );
            return true;
        } catch (error) {
            console.error('Failed optimizing pasted image:', error);
            return false;
        }
    }, [reserveAttachmentSlots, stagePreparedAttachments]);

    useEffect(() => {
        onAddFiles?.(enqueueFiles);
    }, [enqueueFiles, onAddFiles]);

    useEffect(() => {
        attachmentsRef.current = attachments;
    }, [attachments]);

    useEffect(() => {
        return () => {
            attachmentsRef.current.forEach((attachment) => {
                if (attachment.preview) URL.revokeObjectURL(attachment.preview);
            });
        };
    }, []);

    const startQueuedUploads = useCallback(() => {
        const available = Math.max(0, UPLOAD_CONCURRENCY - activeUploadIdsRef.current.size);
        if (available === 0) return;

        attachmentsRef.current
            .filter((attachment) => attachment.status === 'queued' && !activeUploadIdsRef.current.has(attachment.id))
            .slice(0, available)
            .forEach((attachment) => {
                activeUploadIdsRef.current.add(attachment.id);
                const formData = new FormData();
                formData.append('file', attachment.file);
                formData.append('clientUploadId', attachment.id);
                formData.append('conversationId', conversationId);
                if (attachment.width && attachment.height) {
                    formData.append('width', String(attachment.width));
                    formData.append('height', String(attachment.height));
                }
                if (attachment.tinyBase64) {
                    formData.append('tinyBase64', attachment.tinyBase64);
                }

                setAttachments((prev) =>
                    prev.map((item) =>
                        item.id === attachment.id ? { ...item, status: 'uploading', progress: 50, error: undefined } : item,
                    ),
                );

                // ponytail: the authenticated server action already accepts FormData.
                // Keeping binary uploads on that native path avoids a second multipart parser.
                void uploadAttachment(formData)
                    .then((result) => {
                        setAttachments((prev) =>
                            prev.map((item) => {
                                if (item.id !== attachment.id) return item;
                                if (!result.success || !result.attachment) {
                                    return {
                                        ...item,
                                        status: 'failed',
                                        progress: 0,
                                        attempts: item.attempts + 1,
                                        error: result.error || 'Upload failed',
                                    };
                                }
                                return {
                                    ...item,
                                    status: 'uploaded',
                                    progress: 100,
                                    uploaded: {
                                        ...result.attachment,
                                        localUrl: item.preview,
                                    },
                                    error: undefined,
                                };
                            }),
                        );
                    })
                    .catch(() => {
                        setAttachments((prev) =>
                            prev.map((item) =>
                                item.id === attachment.id
                                    ? { ...item, status: 'failed', progress: 0, attempts: item.attempts + 1, error: 'Upload failed' }
                                    : item,
                            ),
                        );
                    })
                    .finally(() => {
                        activeUploadIdsRef.current.delete(attachment.id);
                        startQueuedUploadsRef.current();
                    });
            });
    }, [conversationId]);

    useEffect(() => {
        startQueuedUploadsRef.current = startQueuedUploads;
    }, [startQueuedUploads]);

    useEffect(() => {
        startQueuedUploads();
    }, [attachments, startQueuedUploads]);

    const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;
        try {
            await enqueueFiles(files);
        } finally {
            if (event.target) event.target.value = '';
        }
    }, [enqueueFiles]);

    const removeAttachment = useCallback((attachmentId: string) => {
        const target = attachmentsRef.current.find((attachment) => attachment.id === attachmentId);
        if (target) releaseAttachmentPreview(target);
        activeUploadIdsRef.current.delete(attachmentId);
        setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
        void cancelAttachmentUpload(attachmentId);
    }, []);

    const retryAttachment = useCallback((attachmentId: string) => {
        setAttachments((prev) =>
            prev.map((attachment) =>
                attachment.id === attachmentId && attachment.attempts < MAX_UPLOAD_RETRIES
                    ? { ...attachment, status: 'queued', error: undefined }
                    : attachment,
            ),
        );
    }, []);

    const clearAttachments = useCallback((keepBackendUploads = false) => {
        // Invalidate any in-flight compression work so cleared files cannot
        // reappear if their async enqueue finishes later in the same thread.
        conversationEpochRef.current += 1;
        attachmentsRef.current.forEach((attachment) => {
            releaseAttachmentPreview(attachment);
            if (!keepBackendUploads) {
                void cancelAttachmentUpload(attachment.id);
            }
        });
        activeUploadIdsRef.current.clear();
        pendingAttachmentReservationsRef.current = 0;
        attachmentsRef.current = [];
        setAttachments([]);
    }, []);

    const waitForAllUploads = useCallback(async (): Promise<UploadedAttachment[] | null> => {
        const check = (): Promise<UploadedAttachment[] | null> => {
            const current = attachmentsRef.current;
            if (current.length === 0) return Promise.resolve([]);
            const hasPending = current.some((a) => a.status === 'queued' || a.status === 'uploading');
            if (!hasPending) {
                const hasFailed = current.some((a) => a.status === 'failed');
                if (hasFailed) return Promise.resolve(null);
                const uploaded = current
                    .filter((a) => a.status === 'uploaded' && a.uploaded && !a.error)
                    .map((a) => a.uploaded!);
                return Promise.resolve(uploaded);
            }
            return new Promise((resolve) => {
                setTimeout(() => resolve(check()), 80);
            });
        };
        return check();
    }, []);

    return {
        attachments,
        attachmentsRef,
        handleFileSelect,
        removeAttachment,
        retryAttachment,
        clearAttachments,
        enqueueFiles,
        enqueuePastedImage,
        waitForAllUploads,
    };
}
