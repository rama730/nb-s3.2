ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS workspace_inbox_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS workspace_due_today_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS workspace_overdue_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS workspace_in_progress_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS profiles_workspace_inbox_count_idx
    ON profiles (workspace_inbox_count);

CREATE INDEX IF NOT EXISTS profiles_workspace_due_today_count_idx
    ON profiles (workspace_due_today_count);

CREATE INDEX IF NOT EXISTS profiles_workspace_overdue_count_idx
    ON profiles (workspace_overdue_count);

CREATE INDEX IF NOT EXISTS profiles_workspace_in_progress_count_idx
    ON profiles (workspace_in_progress_count);

CREATE INDEX IF NOT EXISTS tasks_assignee_status_due_idx
    ON tasks (assignee_id, status, due_date);

WITH task_counts AS (
    SELECT
        assignee_id AS user_id,
        COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND status <> 'done'
              AND due_date IS NOT NULL
              AND due_date <= date_trunc('day', now()) + interval '1 day' - interval '1 millisecond'
        )::int AS due_today_count,
        COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND status <> 'done'
              AND due_date IS NOT NULL
              AND due_date < now()
        )::int AS overdue_count,
        COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND status = 'in_progress'
        )::int AS in_progress_count
    FROM tasks
    WHERE assignee_id IS NOT NULL
    GROUP BY assignee_id
),
connection_counts AS (
    SELECT
        addressee_id AS user_id,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS inbox_count
    FROM connections
    GROUP BY addressee_id
),
counts AS (
    SELECT
        p.id AS user_id,
        COALESCE(cc.inbox_count, 0)::int AS inbox_count,
        COALESCE(tc.due_today_count, 0)::int AS due_today_count,
        COALESCE(tc.overdue_count, 0)::int AS overdue_count,
        COALESCE(tc.in_progress_count, 0)::int AS in_progress_count
    FROM profiles p
    LEFT JOIN task_counts tc ON tc.user_id = p.id
    LEFT JOIN connection_counts cc ON cc.user_id = p.id
)
UPDATE profiles p
SET
    workspace_inbox_count = counts.inbox_count,
    workspace_due_today_count = counts.due_today_count,
    workspace_overdue_count = counts.overdue_count,
    workspace_in_progress_count = counts.in_progress_count
FROM counts
WHERE p.id = counts.user_id;
