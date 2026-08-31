'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelAttachmentUpload, uploadAttachment } from '@/app/actions/messaging';
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
    const progressTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
        try {
            const processedFiles = await compressFilesWithLimit(
                files.slice(0, reservedCount),
                COMPRESSION_CONCURRENCY,
            );
            if (conversationEpochRef.current !== epoch) {
                releaseAttachmentSlots(reservedCount);
                return false;
            }
            stagePreparedAttachments(processedFiles, reservedCount, epoch);
            return true;
        } catch (error) {
            releaseAttachmentSlots(reservedCount);
            console.error('Failed to enqueue files:', error);
            return false;
        }
    }, [releaseAttachmentSlots, reserveAttachmentSlots, stagePreparedAttachments]);

    const enqueuePastedImage = useCallback(async (file: File) => {
        const reservedCount = reserveAttachmentSlots(1);
        if (reservedCount === 0) {
            return false;
        }

        const epoch = conversationEpochRef.current;
        try {
            const compressedFile = await compressImage(file);
            const dimensions = await readMediaDimensions(compressedFile);
            const tinyBase64 = await generateTinyThumbnail(compressedFile) || undefined;
            if (conversationEpochRef.current !== epoch) {
                releaseAttachmentSlots(reservedCount);
                return false;
            }
            return stagePreparedAttachments([{ file: compressedFile, dimensions, tinyBase64 }], reservedCount, epoch) > 0;
        } catch (error) {
            releaseAttachmentSlots(reservedCount);
            throw error;
        }
    }, [releaseAttachmentSlots, reserveAttachmentSlots, stagePreparedAttachments]);

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
            progressTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
            progressTimeoutsRef.current.clear();
        };
    }, []);

    const startQueuedUploads = useCallback(() => {
        const available = Math.max(0, UPLOAD_CONCURRENCY - activeUploadIdsRef.current.size);
        if (available === 0) return;

        attachmentsRef.current
            .filter((attachment) => attachment.status === 'queued' && !activeUploadIdsRef.current.has(attachment.id))
            .slice(0, available)
            .forEach((attachment) => {
                const scheduledEpoch = conversationEpochRef.current;
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
                        item.id === attachment.id ? { ...item, status: 'uploading', progress: 20, error: undefined } : item,
                    ),
                );

                const progressTimeoutId = setTimeout(() => {
                    progressTimeoutsRef.current.delete(attachment.id);
                    setAttachments((prev) =>
                        conversationEpochRef.current !== scheduledEpoch || !prev.some((item) => item.id === attachment.id)
                            ? prev
                            : prev.map((item) =>
                                item.id === attachment.id && item.status === 'uploading'
                                    ? { ...item, progress: 60 }
                                    : item,
                            ),
                    );
                }, 500);
                progressTimeoutsRef.current.set(attachment.id, progressTimeoutId);

                // ponytail: the authenticated server action already accepts FormData.
                // Keeping binary uploads on that native path avoids a second multipart parser.
                void uploadAttachment(formData)
                    .then((result) => {
                        const progressTimeout = progressTimeoutsRef.current.get(attachment.id);
                        if (progressTimeout) {
                            clearTimeout(progressTimeout);
                            progressTimeoutsRef.current.delete(attachment.id);
                        }
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
                        const progressTimeout = progressTimeoutsRef.current.get(attachment.id);
                        if (progressTimeout) {
                            clearTimeout(progressTimeout);
                            progressTimeoutsRef.current.delete(attachment.id);
                        }
                        setAttachments((prev) =>
                            prev.map((item) =>
                                item.id === attachment.id
                                    ? { ...item, status: 'failed', progress: 0, attempts: item.attempts + 1, error: 'Upload failed' }
                                    : item,
                            ),
                        );
                    })
                    .finally(() => {
                        const progressTimeout = progressTimeoutsRef.current.get(attachment.id);
                        if (progressTimeout) {
                            clearTimeout(progressTimeout);
                            progressTimeoutsRef.current.delete(attachment.id);
                        }
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
        const progressTimeout = progressTimeoutsRef.current.get(attachmentId);
        if (progressTimeout) {
            clearTimeout(progressTimeout);
            progressTimeoutsRef.current.delete(attachmentId);
        }
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
            const progressTimeout = progressTimeoutsRef.current.get(attachment.id);
            if (progressTimeout) {
                clearTimeout(progressTimeout);
                progressTimeoutsRef.current.delete(attachment.id);
            }
            if (!keepBackendUploads) {
                void cancelAttachmentUpload(attachment.id);
            }
        });
        activeUploadIdsRef.current.clear();
        progressTimeoutsRef.current.clear();
        pendingAttachmentReservationsRef.current = 0;
        attachmentsRef.current = [];
        setAttachments([]);
    }, []);

    useEffect(() => {
        clearAttachments();
    }, [clearAttachments, conversationId]);

    return {
        attachments,
        attachmentsRef,
        handleFileSelect,
        removeAttachment,
        retryAttachment,
        clearAttachments,
        enqueueFiles,
        enqueuePastedImage,
    };
}
