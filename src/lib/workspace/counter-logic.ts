import { sql, type SQL } from 'drizzle-orm'

const END_OF_DAY_HOURS = 23
const END_OF_DAY_MINUTES = 59
const END_OF_DAY_SECONDS = 59
const END_OF_DAY_MILLISECONDS = 999

export function getWorkspaceCounterWindow(referenceNow: Date = new Date()) {
    const now = new Date(referenceNow)
    const todayEnd = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        END_OF_DAY_HOURS,
        END_OF_DAY_MINUTES,
        END_OF_DAY_SECONDS,
        END_OF_DAY_MILLISECONDS,
    ))
    return { now, todayEnd }
}

export function serializeWorkspaceCounterTimestamp(value: Date | string) {
    return typeof value === 'string' ? value : value.toISOString()
}

export function isOpenWorkspaceTaskStatus(status: string | null | undefined) {
    return status !== 'done'
}

export function isWorkspaceTaskOverdue(
    dueDate: Date | null,
    status: string | null | undefined,
    now: Date,
) {
    return !!dueDate && isOpenWorkspaceTaskStatus(status) && dueDate < now
}

export function isWorkspaceTaskDueToday(
    dueDate: Date | null,
    status: string | null | undefined,
    now: Date,
    todayEnd: Date,
) {
    return !!dueDate
        && isOpenWorkspaceTaskStatus(status)
        && dueDate >= now
        && dueDate <= todayEnd
}

export function buildWorkspaceTaskCounterFilters(
    deletedAtExpression: SQL,
    statusExpression: SQL,
    dueDateExpression: SQL,
    now: Date | string,
    todayEnd: Date | string,
) {
    const nowParam = sql`${serializeWorkspaceCounterTimestamp(now)}::timestamptz`
    const todayEndParam = sql`${serializeWorkspaceCounterTimestamp(todayEnd)}::timestamptz`

    return {
        dueToday: sql`${deletedAtExpression} IS NULL
            AND (${statusExpression} IS NULL OR ${statusExpression} <> 'done')
            AND ${dueDateExpression} IS NOT NULL
            AND ${dueDateExpression} >= ${nowParam}
            AND ${dueDateExpression} <= ${todayEndParam}`,
        overdue: sql`${deletedAtExpression} IS NULL
            AND (${statusExpression} IS NULL OR ${statusExpression} <> 'done')
            AND ${dueDateExpression} IS NOT NULL
            AND ${dueDateExpression} < ${nowParam}`,
        inProgress: sql`${deletedAtExpression} IS NULL
            AND ${statusExpression} = 'in_progress'`,
    }
}
