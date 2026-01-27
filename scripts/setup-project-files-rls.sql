-- RLS + Storage policies for project files subsystem
-- Run this in Supabase SQL editor (service role / admin).

-- ============================================================================
-- STORAGE BUCKET: project-files
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-files', 'project-files', false, 10485760)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760;

-- ============================================================================
-- Helper predicates (inline)
-- - A user can READ if they are project owner or a member (any role).
-- - A user can WRITE if they are project owner or a member with role != 'viewer'.
-- ============================================================================

-- PROJECT NODES
ALTER TABLE public.project_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_nodes_read ON public.project_nodes;
CREATE POLICY project_nodes_read ON public.project_nodes
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_nodes_write ON public.project_nodes;
CREATE POLICY project_nodes_write ON public.project_nodes
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

-- PROJECT FILE INDEX
ALTER TABLE public.project_file_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_file_index_read ON public.project_file_index;
CREATE POLICY project_file_index_read ON public.project_file_index
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_file_index_write ON public.project_file_index;
CREATE POLICY project_file_index_write ON public.project_file_index
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

-- PROJECT NODE LOCKS
ALTER TABLE public.project_node_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_node_locks_read ON public.project_node_locks;
CREATE POLICY project_node_locks_read ON public.project_node_locks
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_node_locks_write ON public.project_node_locks;
CREATE POLICY project_node_locks_write ON public.project_node_locks
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

-- PROJECT NODE EVENTS
ALTER TABLE public.project_node_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_node_events_read ON public.project_node_events;
CREATE POLICY project_node_events_read ON public.project_node_events
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_node_events_write ON public.project_node_events;
CREATE POLICY project_node_events_write ON public.project_node_events
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

-- ============================================================================
-- STORAGE: project-files bucket
-- Path convention: projects/<projectId>/<filename>
-- ============================================================================

-- Enable RLS on storage.objects is already enabled in Supabase.

DROP POLICY IF EXISTS project_files_read ON storage.objects;
CREATE POLICY project_files_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS project_files_write ON storage.objects;
CREATE POLICY project_files_write ON storage.objects
FOR ALL
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
);

