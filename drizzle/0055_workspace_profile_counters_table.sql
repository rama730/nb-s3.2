-- Phase 2: Counter Decoupling - Create dedicated profile_counters table

CREATE TABLE IF NOT EXISTS profile_counters (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    connections_count INTEGER NOT NULL DEFAULT 0,
    projects_count INTEGER NOT NULL DEFAULT 0,
    followers_count INTEGER NOT NULL DEFAULT 0,
    workspace_inbox_count INTEGER NOT NULL DEFAULT 0,
    workspace_due_today_count INTEGER NOT NULL DEFAULT 0,
    workspace_overdue_count INTEGER NOT NULL DEFAULT 0,
    workspace_in_progress_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indices for workspace counter performance
CREATE INDEX IF NOT EXISTS profile_counters_workspace_inbox_count_idx ON profile_counters (workspace_inbox_count);
CREATE INDEX IF NOT EXISTS profile_counters_workspace_due_today_count_idx ON profile_counters (workspace_due_today_count);
CREATE INDEX IF NOT EXISTS profile_counters_workspace_overdue_count_idx ON profile_counters (workspace_overdue_count);
CREATE INDEX IF NOT EXISTS profile_counters_workspace_in_progress_count_idx ON profile_counters (workspace_in_progress_count);

-- Initial data migration from profiles to profile_counters
INSERT INTO profile_counters (
    user_id,
    connections_count,
    projects_count,
    followers_count,
    workspace_inbox_count,
    workspace_due_today_count,
    workspace_overdue_count,
    workspace_in_progress_count,
    updated_at
)
SELECT 
    id,
    connections_count,
    projects_count,
    followers_count,
    workspace_inbox_count,
    workspace_due_today_count,
    workspace_overdue_count,
    workspace_in_progress_count,
    updated_at
FROM profiles
ON CONFLICT (user_id) DO UPDATE SET
    connections_count = EXCLUDED.connections_count,
    projects_count = EXCLUDED.projects_count,
    followers_count = EXCLUDED.followers_count,
    workspace_inbox_count = EXCLUDED.workspace_inbox_count,
    workspace_due_today_count = EXCLUDED.workspace_due_today_count,
    workspace_overdue_count = EXCLUDED.workspace_overdue_count,
    workspace_in_progress_count = EXCLUDED.workspace_in_progress_count,
    updated_at = EXCLUDED.updated_at;
