-- ============================================================================
-- SUPABASE AI ADVISOR REMEDIATIONS (PERFORMANCE & CORRECTNESS)
-- ============================================================================

-- 1. ADD MISSING PRIMARY KEYS
-- The dm_pairs table was flagged for missing a primary key.
DO $$
DECLARE
  existing_pk text;
BEGIN
  SELECT conname
  INTO existing_pk
  FROM pg_constraint
  WHERE conrelid = 'public.dm_pairs'::regclass
    AND contype = 'p';

  IF existing_pk IS NOT NULL AND existing_pk <> 'dm_pairs_user_low_user_high_pk' THEN
    EXECUTE format('ALTER TABLE public.dm_pairs DROP CONSTRAINT %I', existing_pk);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.dm_pairs'::regclass
      AND conname = 'dm_pairs_user_low_user_high_pk'
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.dm_pairs
      ADD CONSTRAINT dm_pairs_user_low_user_high_pk PRIMARY KEY (user_low, user_high);
  END IF;
END $$;

-- 2. RLS INITPLAN OPTIMIZATION (auth.uid() wrappers)
-- Wrapping auth.uid() in a stable function forces PostgreSQL to evaluate it ONCE
-- per query (initplan) rather than once per row, drastically improving RLS performance
-- when selecting multiple rows.
CREATE OR REPLACE FUNCTION public.get_auth_uid()
RETURNS uuid 
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Note: We are not rewriting all 60 existing RLS policies in this script yet.
-- Using the wrapper function in new policies or when modifying existing complex policies
-- is the best practice. For this immediate fix, the wrapper is made available.

-- 3. ADD COVERING INDEXES FOR FOREIGN KEYS
-- The advisor flags foreign keys that lack an index, leading to slow cascade deletes and joins.
CREATE INDEX IF NOT EXISTS idx_tasks_creator_id ON public.tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint_id ON public.tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_task_subtasks_task_id ON public.task_subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_task_node_links_created_by ON public.task_node_links(created_by);
CREATE INDEX IF NOT EXISTS idx_task_node_links_node_id ON public.task_node_links(node_id);
CREATE INDEX IF NOT EXISTS idx_task_node_links_task_id ON public.task_node_links(task_id);
CREATE INDEX IF NOT EXISTS idx_saved_projects_project_id ON public.saved_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_saved_projects_user_id ON public.saved_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_role_applications_project_id ON public.role_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_role_applications_decision_by ON public.role_applications(decision_by);
CREATE INDEX IF NOT EXISTS idx_role_applications_applicant_id ON public.role_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_role_applications_role_id ON public.role_applications(role_id);
CREATE INDEX IF NOT EXISTS idx_project_sprints_project_id ON public.project_sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_project_run_sessions_project_id ON public.project_run_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_run_sessions_profile_id ON public.project_run_sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_project_run_sessions_started_by ON public.project_run_sessions(started_by);
CREATE INDEX IF NOT EXISTS idx_project_run_profiles_project_id ON public.project_run_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_project_run_profiles_created_by ON public.project_run_profiles(created_by);
CREATE INDEX IF NOT EXISTS idx_project_run_logs_project_id ON public.project_run_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_run_logs_session_id ON public.project_run_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_project_run_diagnostics_project_id ON public.project_run_diagnostics(project_id);
CREATE INDEX IF NOT EXISTS idx_project_run_diagnostics_session_id ON public.project_run_diagnostics(session_id);
CREATE INDEX IF NOT EXISTS idx_project_run_diagnostics_node_id ON public.project_run_diagnostics(node_id);
CREATE INDEX IF NOT EXISTS idx_project_open_roles_project_id ON public.project_open_roles(project_id);
CREATE INDEX IF NOT EXISTS idx_project_nodes_project_id ON public.project_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_nodes_parent_id ON public.project_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_project_nodes_created_by ON public.project_nodes(created_by);
CREATE INDEX IF NOT EXISTS idx_project_nodes_deleted_by ON public.project_nodes(deleted_by);
CREATE INDEX IF NOT EXISTS idx_project_node_locks_project_id ON public.project_node_locks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_node_locks_node_id ON public.project_node_locks(node_id);
CREATE INDEX IF NOT EXISTS idx_project_node_locks_locked_by ON public.project_node_locks(locked_by);
CREATE INDEX IF NOT EXISTS idx_project_node_events_project_id ON public.project_node_events(project_id);
CREATE INDEX IF NOT EXISTS idx_project_node_events_node_id ON public.project_node_events(node_id);
CREATE INDEX IF NOT EXISTS idx_project_node_events_actor_id ON public.project_node_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_follows_user_id ON public.project_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_project_follows_project_id ON public.project_follows(project_id);
CREATE INDEX IF NOT EXISTS idx_project_file_index_project_id ON public.project_file_index(project_id);
CREATE INDEX IF NOT EXISTS idx_project_file_index_node_id ON public.project_file_index(node_id);
CREATE INDEX IF NOT EXISTS idx_profile_audit_events_user_id ON public.profile_audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_submissions_user_id ON public.onboarding_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_user_id ON public.onboarding_events(user_id);
