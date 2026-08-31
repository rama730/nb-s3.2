import { z } from 'zod';

const MESSAGE_CONTENT_MAX_LENGTH = 4_000;

export const messageTypeSchema = z.enum(['text', 'image', 'video', 'file']);

export const sendMessageSchema = z.object({
    conversationId: z.string().uuid(),
    content: z.string().trim().min(1).max(MESSAGE_CONTENT_MAX_LENGTH),
    type: messageTypeSchema.default('text'),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
});

export const editMessageSchema = z.object({
    messageId: z.string().uuid(),
    content: z.string().trim().min(1).max(MESSAGE_CONTENT_MAX_LENGTH),
});

export const deleteMessageSchema = z.object({
    messageId: z.string().uuid(),
    scope: z.enum(['me', 'everyone']).default('everyone'),
});

