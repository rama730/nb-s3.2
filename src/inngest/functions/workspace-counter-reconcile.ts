import { inngest } from '../client'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export const reconcileWorkspaceProfileCounters = inngest.createFunction(
    { id: 'reconcile-workspace-profile-counters', name: 'Reconcile Workspace Profile Counters' },
    { cron: '*/15 * * * *' },
    async ({ step }) => {
        const now = new Date()
        const todayEnd = new Date(now)
        todayEnd.setHours(23, 59, 59, 999)

        await step.run('rebuild-profile-counters', async () => {
            await db.execute(sql`
                WITH task_counts AS (
                    SELECT
                        ${sql.raw('"assignee_id"')} AS user_id,
                        COUNT(*) FILTER (
                            WHERE ${sql.raw('"deleted_at"')} IS NULL
                              AND ${sql.raw('"status"')} <> 'done'
                              AND ${sql.raw('"due_date"')} IS NOT NULL
                              AND ${sql.raw('"due_date"')} <= ${todayEnd}
                        )::int AS due_today_count,
                        COUNT(*) FILTER (
                            WHERE ${sql.raw('"deleted_at"')} IS NULL
                              AND ${sql.raw('"status"')} <> 'done'
                              AND ${sql.raw('"due_date"')} IS NOT NULL
                              AND ${sql.raw('"due_date"')} < ${now}
                        )::int AS overdue_count,
                        COUNT(*) FILTER (
                            WHERE ${sql.raw('"deleted_at"')} IS NULL
                              AND ${sql.raw('"status"')} = 'in_progress'
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
                UPDATE ${sql.raw('"profiles"')} p
                SET
                    ${sql.raw('"workspace_inbox_count"')} = counts.inbox_count,
                    ${sql.raw('"workspace_due_today_count"')} = counts.due_today_count,
                    ${sql.raw('"workspace_overdue_count"')} = counts.overdue_count,
                    ${sql.raw('"workspace_in_progress_count"')} = counts.in_progress_count
                FROM counts
                WHERE p.${sql.raw('"id"')} = counts.user_id
                  AND (
                    p.${sql.raw('"workspace_inbox_count"')} IS DISTINCT FROM counts.inbox_count
                    OR p.${sql.raw('"workspace_due_today_count"')} IS DISTINCT FROM counts.due_today_count
                    OR p.${sql.raw('"workspace_overdue_count"')} IS DISTINCT FROM counts.overdue_count
                    OR p.${sql.raw('"workspace_in_progress_count"')} IS DISTINCT FROM counts.in_progress_count
                  )
            `)
        })

        return {
            reconciledAt: now.toISOString(),
        }
    }
)
