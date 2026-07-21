-- Remove tables that have no browser subscription path from the realtime publication.
-- This does not delete data; it only stops Supabase Realtime from tracking them.

DO $realtime_trim$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'comment_mentions',
    'message_attachments',
    'message_edit_logs',
    'message_workflow_items'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', target_table);
    END IF;
  END LOOP;
END
$realtime_trim$;
