-- Enforce Auth as the identity authority for every newly-created profile.
-- Existing legacy rows remain reviewable until the constraint is validated in
-- an approved environment reconciliation.
DO $profiles_auth_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_id_auth_users_fk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_auth_users_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$profiles_auth_fk$;

-- Evaluate the request identity once per statement instead of once per row.
DROP POLICY IF EXISTS project_invitations_read_authorized ON public.project_invitations;
CREATE POLICY project_invitations_read_authorized
ON public.project_invitations FOR SELECT TO authenticated
USING (
  candidate_id = (SELECT auth.uid())
  OR inviter_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_invitations.project_id
      AND projects.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_members.project_id = project_invitations.project_id
      AND project_members.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS project_guidance_appointments_read_authorized ON public.project_guidance_appointments;
CREATE POLICY project_guidance_appointments_read_authorized
ON public.project_guidance_appointments FOR SELECT TO authenticated
USING (
  guide_user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_guidance_appointments.project_id
      AND projects.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_members.project_id = project_guidance_appointments.project_id
      AND project_members.user_id = (SELECT auth.uid())
  )
  OR (
    public_attribution_consent
    AND EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_guidance_appointments.project_id
        AND projects.visibility = 'public'
        AND projects.deleted_at IS NULL
    )
  )
);

-- One permissive SELECT owner per contribution table preserves both public
-- external/project contributions and the subject's private self-view.
DROP POLICY IF EXISTS "Public profile contributions are viewable" ON public.profile_project_contributions;
DROP POLICY IF EXISTS "Users can view own profile contributions" ON public.profile_project_contributions;
DROP POLICY IF EXISTS profile_contributions_read_authorized ON public.profile_project_contributions;
CREATE POLICY profile_contributions_read_authorized
ON public.profile_project_contributions FOR SELECT
USING (
  profile_id = (SELECT app_private.get_auth_uid())
  OR (
    visibility = 'public'
    AND deleted_at IS NULL
    AND (
      (project_id IS NULL AND external_key IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.projects project
        WHERE project.id = profile_project_contributions.project_id
          AND project.deleted_at IS NULL
          AND project.visibility IN ('public', 'unlisted')
          AND project.status <> 'draft'
      )
    )
  )
);

DROP POLICY IF EXISTS "Public profile contribution stages are viewable" ON public.profile_project_contribution_stages;
DROP POLICY IF EXISTS "Users can view own profile contribution stages" ON public.profile_project_contribution_stages;
DROP POLICY IF EXISTS profile_contribution_stages_read_authorized ON public.profile_project_contribution_stages;
CREATE POLICY profile_contribution_stages_read_authorized
ON public.profile_project_contribution_stages FOR SELECT
USING (
  profile_id = (SELECT app_private.get_auth_uid())
  OR EXISTS (
    SELECT 1
    FROM public.profile_project_contributions contribution
    LEFT JOIN public.projects project ON project.id = contribution.project_id
    WHERE contribution.id = profile_project_contribution_stages.contribution_id
      AND contribution.deleted_at IS NULL
      AND contribution.visibility = 'public'
      AND (
        (contribution.project_id IS NULL AND contribution.external_key IS NOT NULL)
        OR (
          project.deleted_at IS NULL
          AND project.visibility IN ('public', 'unlisted')
          AND project.status <> 'draft'
        )
      )
  )
);

-- Keep the original constraint-backed pair authority; remove only the later
-- redundant standalone unique index.
DROP INDEX IF EXISTS public.dm_pairs_user_low_user_high_key;

CREATE OR REPLACE FUNCTION public.seed_project_workflow_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.project_workflow_columns (
    project_id, status, title, accent_class_name, empty_title,
    empty_description, position, is_default
  )
  VALUES
    (NEW.id, 'todo', 'To Do', 'zinc', 'Tasks will appear here...', 'Tasks that are ready to start will appear here. Drag and drop your tasks here.', 0, TRUE),
    (NEW.id, 'in_progress', 'In Progress', 'blue', 'Tasks will appear here...', 'Items will appear here as soon as they start. Drag and drop your tasks here.', 1, TRUE),
    (NEW.id, 'blocked', 'Issues', 'rose', 'Tasks will appear here...', 'Tasks waiting on blockers will appear here. Drag and drop your tasks here.', 2, TRUE),
    (NEW.id, 'done', 'Done', 'emerald', 'Tasks will appear here...', 'Finished work will appear here. Drag and drop your tasks here.', 3, TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_project_workflow_columns() FROM PUBLIC;
DO $workflow_function_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.seed_project_workflow_columns() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.seed_project_workflow_columns() FROM authenticated';
  END IF;
END
$workflow_function_roles$;

ALTER TABLE app_private.retired_domain_archive ENABLE ROW LEVEL SECURITY;

-- Legacy task-file uploads now match the canonical project-files writer rule.
DROP POLICY IF EXISTS task_files_insert ON storage.objects;
CREATE POLICY task_files_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'task-files'
  AND split_part(name, '/', 1) <> ''
  AND (
    EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = split_part(objects.name, '/', 1)
        AND project.deleted_at IS NULL
        AND project.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members member
      WHERE member.project_id::text = split_part(objects.name, '/', 1)
        AND member.user_id = (SELECT auth.uid())
        AND member.role <> 'viewer'
    )
  )
);
