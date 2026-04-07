'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelAttachmentUpload, uploadAttachment } from '@/app/actions/messaging';
import { compressImage } from '@/lib/messages/image-compression';
import {
    MAX_UPLOAD_RETRIES,
    type PendingAttachment,
} from './message-composer-v2-shared';

const MAX_ATTACHMENTS = 12;
const UPLOAD_CONCURRENCY = 3;

interface UseMessageComposerAttachmentsParams {
    conversationId: string;
    onAddFiles?: (register: (files: File[]) => void) => void;
}

function createPendingAttachment(file: File): PendingAttachment {
    return {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        status: 'queued',
        progress: 0,
        attempts: 0,
    };
}

export function useMessageComposerAttachments({
    conversationId,
    onAddFiles,
}: UseMessageComposerAttachmentsParams) {
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const [uploadsPaused, setUploadsPaused] = useState(false);
    const attachmentsRef = useRef<PendingAttachment[]>([]);
    const uploadsPausedRef = useRef(uploadsPaused);
    const activeUploadIdsRef = useRef<Set<string>>(new Set());
    const startQueuedUploadsRef = useRef<() => void>(() => undefined);

    const enqueueFiles = useCallback(async (files: File[]) => {
        const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
        const filesToAdd = files.slice(0, availableSlots);
        const processedFiles = await Promise.all(filesToAdd.map((file) => compressImage(file)));
        const nextItems = processedFiles.map((file) => createPendingAttachment(file));
        setAttachments((prev) => [...prev, ...nextItems]);
    }, []);

    const enqueuePastedImage = useCallback(async (file: File) => {
        const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
        if (availableSlots === 0) {
            return false;
        }
        const compressedFile = await compressImage(file);
        setAttachments((prev) => [...prev, createPendingAttachment(compressedFile)]);
        return true;
    }, []);

    useEffect(() => {
        onAddFiles?.(enqueueFiles);
    }, [enqueueFiles, onAddFiles]);

    useEffect(() => {
        attachmentsRef.current = attachments;
    }, [attachments]);

    useEffect(() => {
        uploadsPausedRef.current = uploadsPaused;
    }, [uploadsPaused]);

    useEffect(() => {
        return () => {
            attachmentsRef.current.forEach((attachment) => {
                if (attachment.preview) URL.revokeObjectURL(attachment.preview);
            });
        };
    }, []);

    const startQueuedUploads = useCallback(() => {
        if (uploadsPausedRef.current) return;
        const available = Math.max(0, UPLOAD_CONCURRENCY - activeUploadIdsRef.current.size);
        if (available === 0) return;

        attachmentsRef.current
            .filter((attachment) => attachment.status === 'queued')
            .slice(0, available)
            .forEach((attachment) => {
                activeUploadIdsRef.current.add(attachment.id);
                const formData = new FormData();
                formData.append('file', attachment.file);
                formData.append('clientUploadId', attachment.id);
                formData.append('conversationId', conversationId);

                setAttachments((prev) =>
                    prev.map((item) =>
                        item.id === attachment.id ? { ...item, status: 'uploading', progress: 20, error: undefined } : item,
                    ),
                );

                setTimeout(() => {
                    setAttachments((prev) =>
                        prev.map((item) =>
                            item.id === attachment.id && item.status === 'uploading'
                                ? { ...item, progress: 60 }
                                : item,
                        ),
                    );
                }, 500);

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
                                    uploaded: result.attachment,
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
        await enqueueFiles(files);
        if (event.target) event.target.value = '';
    }, [enqueueFiles]);

    const removeAttachment = useCallback((attachmentId: string) => {
        const target = attachmentsRef.current.find((attachment) => attachment.id === attachmentId);
        if (target?.preview) URL.revokeObjectURL(target.preview);
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

    const clearAttachments = useCallback(() => {
        attachmentsRef.current.forEach((attachment) => {
            if (attachment.preview) URL.revokeObjectURL(attachment.preview);
            void cancelAttachmentUpload(attachment.id);
        });
        activeUploadIdsRef.current.clear();
        attachmentsRef.current = [];
        setAttachments([]);
    }, []);

    useEffect(() => {
        clearAttachments();
    }, [clearAttachments, conversationId]);

    return {
        attachments,
        attachmentsRef,
        uploadsPaused,
        setUploadsPaused,
        handleFileSelect,
        removeAttachment,
        retryAttachment,
        enqueuePastedImage,
        clearAttachments,
    };
}
