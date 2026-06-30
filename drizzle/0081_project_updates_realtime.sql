-- ============================================================================
-- Supabase realtime publication coverage for app-level subscribers.
-- Keep this idempotent: some production databases may already contain a subset
-- of these tables in the publication from older/manual setup paths.
-- ============================================================================

DO $$
DECLARE
  realtime_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RETURN;
  END IF;

  FOREACH realtime_table IN ARRAY ARRAY[
    'profiles',
    'projects',
    'tasks',
    'task_comments',
    'task_subtasks',
    'task_comment_likes',
    'task_node_links',
    'project_updates',
    'project_update_comments'
  ] LOOP
    IF to_regclass(format('public.%I', realtime_table)) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = realtime_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', realtime_table);
    END IF;
  END LOOP;
END $$;
