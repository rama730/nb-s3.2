import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sendMessageSchema, editMessageSchema, deleteMessageSchema } from '../../src/lib/validations/messaging'

describe('sendMessageSchema', () => {
    const validId = '123e4567-e89b-42d3-a456-426614174000'

    it('passes with valid text message', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: validId,
            content: 'Hello!',
        })
        assert.equal(result.success, true)
    })

    it('rejects empty content', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: validId,
            content: '',
        })
        assert.equal(result.success, false)
    })

    it('rejects content over 10k chars', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: validId,
            content: 'x'.repeat(10_001),
        })
        assert.equal(result.success, false)
    })

    it('rejects invalid UUID for conversationId', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: 'not-a-uuid',
            content: 'Hello!',
        })
        assert.equal(result.success, false)
    })

    it('defaults type to text', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: validId,
            content: 'Hello!',
        })
        assert.equal(result.success, true)
        if (result.success) {
            assert.equal(result.data.type, 'text')
        }
    })

    it('accepts file type', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: validId,
            content: 'file.pdf',
            type: 'file',
        })
        assert.equal(result.success, true)
    })

    it('limits attachments to 10', () => {
        const result = sendMessageSchema.safeParse({
            conversationId: validId,
            content: 'msg',
            attachmentIds: Array.from({ length: 11 }, (_, i) =>
                `123e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`
            ),
        })
        assert.equal(result.success, false)
    })
})

describe('editMessageSchema', () => {
    it('passes with valid input', () => {
        const result = editMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174001',
            content: 'Updated!',
        })
        assert.equal(result.success, true)
    })

    it('rejects empty content', () => {
        const result = editMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174001',
            content: '',
        })
        assert.equal(result.success, false)
    })
})

describe('deleteMessageSchema', () => {
    it('defaults scope to everyone', () => {
        const result = deleteMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174002',
        })
        assert.equal(result.success, true)
        if (result.success) {
            assert.equal(result.data.scope, 'everyone')
        }
    })

    it('accepts me scope', () => {
        const result = deleteMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174002',
            scope: 'me',
        })
        assert.equal(result.success, true)
    })
})
