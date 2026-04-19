import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getWorkspaceCounterWindow,
    isWorkspaceTaskDueToday,
    isWorkspaceTaskOverdue,
    buildWorkspaceTaskCounterFilters,
    serializeWorkspaceCounterTimestamp,
} from '@/lib/workspace/counter-logic'
import { sql } from 'drizzle-orm'

test('workspace counter window ends at UTC end of day', () => {
    const reference = new Date('2026-03-20T10:15:30.000Z')
    const { now, todayEnd } = getWorkspaceCounterWindow(reference)

    assert.equal(now.toISOString(), '2026-03-20T10:15:30.000Z')
    assert.equal(todayEnd.getUTCFullYear(), 2026)
    assert.equal(todayEnd.getUTCMonth(), 2)
    assert.equal(todayEnd.getUTCDate(), 20)
    assert.equal(todayEnd.getUTCHours(), 23)
    assert.equal(todayEnd.getUTCMinutes(), 59)
    assert.equal(todayEnd.getUTCSeconds(), 59)
    assert.equal(todayEnd.getUTCMilliseconds(), 999)
})

test('workspace task due-today excludes overdue tasks from earlier today', () => {
    const now = new Date('2026-03-20T15:00:00.000Z')
    const { todayEnd } = getWorkspaceCounterWindow(now)

    const overdueEarlierToday = new Date('2026-03-20T09:00:00.000Z')
    const dueLaterToday = new Date('2026-03-20T18:00:00.000Z')

    assert.equal(isWorkspaceTaskOverdue(overdueEarlierToday, 'todo', now), true)
    assert.equal(isWorkspaceTaskDueToday(overdueEarlierToday, 'todo', now, todayEnd), false)
    assert.equal(isWorkspaceTaskDueToday(dueLaterToday, 'todo', now, todayEnd), true)
})

test('workspace task counter logic ignores done tasks', () => {
    const now = new Date('2026-03-20T15:00:00.000Z')
    const { todayEnd } = getWorkspaceCounterWindow(now)
    const dueLaterToday = new Date('2026-03-20T18:00:00.000Z')

    assert.equal(isWorkspaceTaskOverdue(dueLaterToday, 'done', now), false)
    assert.equal(isWorkspaceTaskDueToday(dueLaterToday, 'done', now, todayEnd), false)
})

test('workspace counter timestamps serialize dates to ISO strings', () => {
    const now = new Date('2026-03-20T15:00:00.000Z')
    assert.equal(serializeWorkspaceCounterTimestamp(now), '2026-03-20T15:00:00.000Z')
    assert.equal(
        serializeWorkspaceCounterTimestamp('2026-03-20T23:59:59.999Z'),
        '2026-03-20T23:59:59.999Z',
    )
})

test('workspace task counter filters do not embed raw Date instances in SQL params', () => {
    const now = new Date('2026-03-20T15:00:00.000Z')
    const todayEnd = new Date('2026-03-20T23:59:59.999Z')
    const filters = buildWorkspaceTaskCounterFilters(
        sql.raw('"deleted_at"'),
        sql.raw('"status"'),
        sql.raw('"due_date"'),
        now,
        todayEnd,
    )

    const collectDateInstances = (value: unknown, found: Date[] = []): Date[] => {
        if (value instanceof Date) {
            found.push(value)
            return found
        }
        if (Array.isArray(value)) {
            for (const item of value) collectDateInstances(item, found)
            return found
        }
        if (value && typeof value === 'object' && 'queryChunks' in value) {
            collectDateInstances((value as { queryChunks: unknown[] }).queryChunks, found)
        }
        return found
    }

    const dueTodayDates = collectDateInstances(filters.dueToday)
    const overdueDates = collectDateInstances(filters.overdue)

    assert.equal(dueTodayDates.length, 0)
    assert.equal(overdueDates.length, 0)
})
