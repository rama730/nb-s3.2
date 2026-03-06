import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    nodeNameSchema,
    createFolderSchema,
    createFileSchema,
    renameNodeSchema,
    deleteNodeSchema,
} from '../../src/lib/validations/files'

const validId = '123e4567-e89b-42d3-a456-426614174000'

describe('nodeNameSchema', () => {
    it('accepts valid names', () => {
        for (const name of ['readme.md', 'src', 'my-file.tsx', 'data_v2.json']) {
            const result = nodeNameSchema.safeParse(name)
            assert.equal(result.success, true, `Expected "${name}" to be valid`)
        }
    })

    it('rejects empty name', () => {
        const result = nodeNameSchema.safeParse('')
        assert.equal(result.success, false)
    })

    it('rejects names with slashes', () => {
        const result = nodeNameSchema.safeParse('path/file.txt')
        assert.equal(result.success, false)
    })

    it('rejects . and .. as names', () => {
        assert.equal(nodeNameSchema.safeParse('.').success, false)
        assert.equal(nodeNameSchema.safeParse('..').success, false)
    })

    it('rejects names over 255 chars', () => {
        const result = nodeNameSchema.safeParse('a'.repeat(256))
        assert.equal(result.success, false)
    })

    it('rejects names with control characters', () => {
        const result = nodeNameSchema.safeParse('file\x00name')
        assert.equal(result.success, false)
    })

    it('rejects names with < > : |', () => {
        for (const c of ['<', '>', ':', '|', '"', '?', '*']) {
            const result = nodeNameSchema.safeParse(`file${c}name`)
            assert.equal(result.success, false, `Expected name with '${c}' to be invalid`)
        }
    })
})

describe('createFolderSchema', () => {
    it('passes with valid input', () => {
        const result = createFolderSchema.safeParse({
            projectId: validId,
            parentId: null,
            name: 'src',
        })
        assert.equal(result.success, true)
    })

    it('accepts UUID parentId', () => {
        const result = createFolderSchema.safeParse({
            projectId: validId,
            parentId: validId,
            name: 'components',
        })
        assert.equal(result.success, true)
    })
})

describe('createFileSchema', () => {
    it('passes with valid input', () => {
        const result = createFileSchema.safeParse({
            projectId: validId,
            parentId: null,
            name: 'index.ts',
            s3Key: 'projects/abc/index.ts',
            size: 1024,
            mimeType: 'text/typescript',
        })
        assert.equal(result.success, true)
    })

    it('rejects negative size', () => {
        const result = createFileSchema.safeParse({
            projectId: validId,
            parentId: null,
            name: 'index.ts',
            s3Key: 'key',
            size: -1,
            mimeType: 'text/plain',
        })
        assert.equal(result.success, false)
    })
})

describe('renameNodeSchema', () => {
    it('passes with valid input', () => {
        const result = renameNodeSchema.safeParse({
            nodeId: validId,
            projectId: validId,
            newName: 'renamed.ts',
        })
        assert.equal(result.success, true)
    })
})

describe('deleteNodeSchema', () => {
    it('requires valid UUIDs', () => {
        const result = deleteNodeSchema.safeParse({
            nodeId: 'bad',
            projectId: validId,
        })
        assert.equal(result.success, false)
    })
})
