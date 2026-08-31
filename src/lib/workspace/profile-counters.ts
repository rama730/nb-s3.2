import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { buildWorkspaceTaskCounterFilters, getWorkspaceCounterWindow } from '@/lib/workspace/counter-logic'
import { isLooseUuid } from '@/lib/validations/uuid'

type WorkspaceCounterExecutor = Pick<typeof db, 'execute'>

function normalizeUserIds(userIds: Array<string | null | undefined>) {
    return [...new Set(
        userIds
            .map((userId) => typeof userId === 'string' ? userId.trim() : '')
            .filter((userId): userId is string => isLooseUuid(userId)),
    )]
}

export async function refreshWorkspaceCountersForUsers(
    executor: WorkspaceCounterExecutor,
    userIds: Array<string | null | undefined>,
) {
    const targetUserIds = normalizeUserIds(userIds)
    if (targetUserIds.length === 0) return

    const { now, todayEnd } = getWorkspaceCounterWindow()
    const deletedAtColumn = sql.raw('"deleted_at"')
    const statusColumn = sql.raw('"status"')
    const dueDateColumn = sql.raw('"due_date"')
    const taskCounterFilters = buildWorkspaceTaskCounterFilters(
        deletedAtColumn,
        statusColumn,
        dueDateColumn,
        now,
        todayEnd,
    )

    const values = sql.join(targetUserIds.map((userId) => sql`(${userId}::uuid)`), sql`, `)

    await executor.execute(sql`
        WITH target_users(user_id) AS (
            VALUES ${values}
        ),
        task_counts AS (
            SELECT
                ${sql.raw('"assignee_id"')} AS user_id,
                COUNT(*) FILTER (
                    WHERE ${taskCounterFilters.dueToday}
                )::int AS due_today_count,
                COUNT(*) FILTER (
                    WHERE ${taskCounterFilters.overdue}
                )::int AS overdue_count,
                COUNT(*) FILTER (
                    WHERE ${taskCounterFilters.inProgress}
                )::int AS in_progress_count
            FROM ${sql.raw('"tasks"')}
            WHERE ${sql.raw('"assignee_id"')} IN (SELECT user_id FROM target_users)
            GROUP BY ${sql.raw('"assignee_id"')}
        ),
        connection_counts AS (
            SELECT
                ${sql.raw('"addressee_id"')} AS user_id,
                COUNT(*) FILTER (WHERE ${sql.raw('"status"')} = 'pending')::int AS inbox_count
            FROM ${sql.raw('"connections"')}
            WHERE ${sql.raw('"addressee_id"')} IN (SELECT user_id FROM target_users)
            GROUP BY ${sql.raw('"addressee_id"')}
        ),
        counts AS (
            SELECT
                tu.user_id,
                COALESCE(cc.inbox_count, 0)::int AS inbox_count,
                COALESCE(tc.due_today_count, 0)::int AS due_today_count,
                COALESCE(tc.overdue_count, 0)::int AS overdue_count,
                COALESCE(tc.in_progress_count, 0)::int AS in_progress_count
            FROM target_users tu
            LEFT JOIN task_counts tc ON tc.user_id = tu.user_id
            LEFT JOIN connection_counts cc ON cc.user_id = tu.user_id
        )
        UPDATE ${sql.raw('"profiles"')} profile
        SET ${sql.raw('"workspace_inbox_count"')} = counts.inbox_count,
            ${sql.raw('"workspace_due_today_count"')} = counts.due_today_count,
            ${sql.raw('"workspace_overdue_count"')} = counts.overdue_count,
            ${sql.raw('"workspace_in_progress_count"')} = counts.in_progress_count,
            ${sql.raw('"updated_at"')} = NOW()
        FROM counts
        WHERE profile.${sql.raw('"id"')} = counts.user_id
    `)
}
