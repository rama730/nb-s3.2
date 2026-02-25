import { z } from 'zod'

const nodeNamePattern = /^[^/\\<>:"|?*\x00-\x1F]+$/

export const nodeNameSchema = z
    .string()
    .min(1)
    .max(255)
    .trim()
    .refine((v) => nodeNamePattern.test(v), {
        message: 'Name contains invalid characters',
    })
    .refine((v) => v !== '.' && v !== '..', {
        message: 'Name cannot be . or ..',
    })

export const createFolderSchema = z.object({
    projectId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    name: nodeNameSchema,
})

export const createFileSchema = z.object({
    projectId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    name: nodeNameSchema,
    s3Key: z.string().min(1).max(1024),
    size: z.number().int().min(0),
    mimeType: z.string().max(255),
})

export const renameNodeSchema = z.object({
    nodeId: z.string().uuid(),
    projectId: z.string().uuid(),
    newName: nodeNameSchema,
})

export const deleteNodeSchema = z.object({
    nodeId: z.string().uuid(),
    projectId: z.string().uuid(),
})

export type CreateFolderInput = z.infer<typeof createFolderSchema>
export type CreateFileInput = z.infer<typeof createFileSchema>
export type RenameNodeInput = z.infer<typeof renameNodeSchema>
export type DeleteNodeInput = z.infer<typeof deleteNodeSchema>
