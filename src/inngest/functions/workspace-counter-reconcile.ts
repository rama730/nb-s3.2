import { inngest } from '../client'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { buildWorkspaceTaskCounterFilters, getWorkspaceCounterWindow } from '@/lib/workspace/counter-logic'

export const reconcileWorkspaceProfileCounters = inngest.createFunction(
    { id: 'reconcile-workspace-profile-counters', name: 'Reconcile Workspace Profile Counters' },
    { cron: '*/15 * * * *' },
    async ({ step }) => {
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

        await step.run('rebuild-profile-counters', async () => {
            await db.execute(sql`
                WITH task_counts AS (
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
                    WHERE ${sql.raw('"assignee_id"')} IS NOT NULL
                    GROUP BY ${sql.raw('"assignee_id"')}
                ),
                connection_counts AS (
                    SELECT
                        ${sql.raw('"addressee_id"')} AS user_id,
                        COUNT(*) FILTER (WHERE ${sql.raw('"status"')} = 'pending')::int AS inbox_count
                    FROM ${sql.raw('"connections"')}
                    GROUP BY ${sql.raw('"addressee_id"')}
                ),
                counts AS (
                    SELECT
                        p.${sql.raw('"id"')} AS user_id,
                        COALESCE(cc.inbox_count, 0)::int AS inbox_count,
                        COALESCE(tc.due_today_count, 0)::int AS due_today_count,
                        COALESCE(tc.overdue_count, 0)::int AS overdue_count,
                        COALESCE(tc.in_progress_count, 0)::int AS in_progress_count
                    FROM ${sql.raw('"profiles"')} p
                    LEFT JOIN task_counts tc ON tc.user_id = p.${sql.raw('"id"')}
                    LEFT JOIN connection_counts cc ON cc.user_id = p.${sql.raw('"id"')}
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
        })

        return {
            reconciledAt: now.toISOString(),
        }
    }
)
