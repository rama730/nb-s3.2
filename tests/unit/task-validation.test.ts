import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTaskSchema, updateTaskFieldSchema, taskPriorityEnum, taskStatusEnum } from '../../src/lib/validations/task'

const validId = '123e4567-e89b-42d3-a456-426614174000'

describe('createTaskSchema', () => {
    it('passes with minimal valid input', () => {
        const result = createTaskSchema.safeParse({
            projectId: validId,
            title: 'Fix the bug',
        })
        assert.equal(result.success, true)
        if (result.success) {
            assert.equal(result.data.status, 'todo')
            assert.equal(result.data.priority, 'medium')
        }
    })

    it('rejects empty title', () => {
        const result = createTaskSchema.safeParse({
            projectId: validId,
            title: '',
        })
        assert.equal(result.success, false)
    })

    it('rejects title over 500 chars', () => {
        const result = createTaskSchema.safeParse({
            projectId: validId,
            title: 'x'.repeat(501),
        })
        assert.equal(result.success, false)
    })

    it('accepts all priority values', () => {
        for (const p of ['low', 'medium', 'high', 'urgent']) {
            const result = taskPriorityEnum.safeParse(p)
            assert.equal(result.success, true)
        }
    })

    it('rejects invalid priority', () => {
        const result = taskPriorityEnum.safeParse('critical')
        assert.equal(result.success, false)
    })

    it('accepts all status values', () => {
        for (const s of ['todo', 'in_progress', 'done', 'blocked']) {
            const result = taskStatusEnum.safeParse(s)
            assert.equal(result.success, true)
        }
    })

    it('rejects negative story points', () => {
        const result = createTaskSchema.safeParse({
            projectId: validId,
            title: 'Task',
            storyPoints: -1,
        })
        assert.equal(result.success, false)
    })

    it('rejects story points over 100', () => {
        const result = createTaskSchema.safeParse({
            projectId: validId,
            title: 'Task',
            storyPoints: 101,
        })
        assert.equal(result.success, false)
    })
})

describe('updateTaskFieldSchema', () => {
    it('passes with valid field and value', () => {
        const result = updateTaskFieldSchema.safeParse({
            taskId: validId,
            projectId: validId,
            field: 'title',
            value: 'Updated title',
        })
        assert.equal(result.success, true)
    })

    it('rejects invalid field name', () => {
        const result = updateTaskFieldSchema.safeParse({
            taskId: validId,
            projectId: validId,
            field: 'status',
            value: 'done',
        })
        assert.equal(result.success, false)
    })
})
