-- profiles is the read authority for these counters. Preserve the latest
-- projection values once, then remove the write-only duplicate table.
UPDATE public.profiles profile
SET connections_count = counters.connections_count,
    projects_count = counters.projects_count,
    followers_count = counters.followers_count,
    workspace_inbox_count = counters.workspace_inbox_count,
    workspace_due_today_count = counters.workspace_due_today_count,
    workspace_overdue_count = counters.workspace_overdue_count,
    workspace_in_progress_count = counters.workspace_in_progress_count,
    updated_at = GREATEST(profile.updated_at, counters.updated_at)
FROM public.profile_counters counters
WHERE counters.user_id = profile.id;

DROP TABLE public.profile_counters;
