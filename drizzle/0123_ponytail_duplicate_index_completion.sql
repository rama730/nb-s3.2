-- The post-deploy catalog audit found four exact non-constraint copies whose
-- unique/primary counterparts already provide the same access path.
DROP INDEX IF EXISTS public.profiles_email_idx;
DROP INDEX IF EXISTS public.idx_project_file_index_node_id;
DROP INDEX IF EXISTS public.idx_project_node_locks_node_id;
DROP INDEX IF EXISTS public.projects_key_idx;
