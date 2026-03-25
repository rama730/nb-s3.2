import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getWorkspaceCounterWindow,
    isWorkspaceTaskDueToday,
    isWorkspaceTaskOverdue,
} from '@/lib/workspace/counter-logic'

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
