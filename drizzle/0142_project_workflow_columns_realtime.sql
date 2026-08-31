ALTER TABLE public.project_workflow_columns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project workflow columns are viewable by project readers" ON public.project_workflow_columns;
CREATE POLICY "Project workflow columns are viewable by project readers"
ON public.project_workflow_columns FOR SELECT
USING (app_private.nb_project_can_read(project_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'project_workflow_columns'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_workflow_columns;
  END IF;
END $$;
