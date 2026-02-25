import { z } from 'zod'

export const sendMessageSchema = z.object({
    conversationId: z.string().uuid(),
    content: z.string().min(1).max(10_000).trim(),
    type: z.enum(['text', 'image', 'video', 'file']).default('text'),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    clientMessageId: z.string().max(100).trim().optional(),
    replyToMessageId: z.string().uuid().nullable().optional(),
})

export const editMessageSchema = z.object({
    messageId: z.string().uuid(),
    content: z.string().min(1).max(10_000).trim(),
})

export const deleteMessageSchema = z.object({
    messageId: z.string().uuid(),
    scope: z.enum(['me', 'everyone']).default('everyone'),
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type EditMessageInput = z.infer<typeof editMessageSchema>
export type DeleteMessageInput = z.infer<typeof deleteMessageSchema>
