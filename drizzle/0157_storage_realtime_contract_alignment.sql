-- Align native Storage and Realtime authorization with the application-owned
-- key/topic grammars. Legacy project-file keys remain readable during repair.

UPDATE storage.buckets
SET file_size_limit = 8388608
WHERE id = 'project-updates-media';

DROP POLICY IF EXISTS project_files_select ON storage.objects;
DROP POLICY IF EXISTS project_files_insert ON storage.objects;
DROP POLICY IF EXISTS project_files_update ON storage.objects;
DROP POLICY IF EXISTS project_files_delete ON storage.objects;

CREATE POLICY project_files_select ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'project-files'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND project.deleted_at IS NULL
        AND project.visibility = 'public'
    )
    OR EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND project.deleted_at IS NULL
        AND project.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members member
      WHERE member.project_id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND member.user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY project_files_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND project.deleted_at IS NULL
        AND project.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members member
      WHERE member.project_id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND member.user_id = (SELECT auth.uid())
        AND member.role <> 'viewer'
    )
  )
);

CREATE POLICY project_files_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND project.deleted_at IS NULL
        AND project.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members member
      WHERE member.project_id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND member.user_id = (SELECT auth.uid())
        AND member.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND project.deleted_at IS NULL
        AND project.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members member
      WHERE member.project_id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND member.user_id = (SELECT auth.uid())
        AND member.role <> 'viewer'
    )
  )
);

CREATE POLICY project_files_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND project.deleted_at IS NULL
        AND project.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members member
      WHERE member.project_id::text = CASE
        WHEN split_part(objects.name, '/', 1) = 'projects' THEN split_part(objects.name, '/', 2)
        ELSE split_part(objects.name, '/', 1)
      END
        AND member.user_id = (SELECT auth.uid())
        AND member.role <> 'viewer'
    )
  )
);

-- Supabase owns realtime.messages and enables RLS by default. Managed projects
-- permit policy management but intentionally reject ALTER TABLE on this table.
DROP POLICY IF EXISTS application_topic_read ON realtime.messages;
DROP POLICY IF EXISTS application_topic_send ON realtime.messages;

CREATE OR REPLACE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_target_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants viewer
      JOIN public.conversation_participants target
        ON target.conversation_id = viewer.conversation_id
      WHERE viewer.user_id = (SELECT auth.uid())
        AND target.user_id = p_target_user_id
    );
$$;

REVOKE ALL ON FUNCTION app_private.nb_can_observe_user_presence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.nb_can_observe_user_presence(uuid) TO authenticated, service_role;

CREATE POLICY application_topic_read ON realtime.messages
FOR SELECT TO authenticated
USING (
  CASE
    WHEN (SELECT realtime.topic()) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_can_observe_user_presence(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:conversation:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_is_conversation_participant(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.id::text = split_part((SELECT realtime.topic()), ':', 3)
          AND app_private.nb_project_can_read(task.project_id)
      )
    WHEN (SELECT realtime.topic()) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.nb_project_can_read(split_part((SELECT realtime.topic()), ':', 2)::uuid)
    ELSE FALSE
  END
);

CREATE POLICY application_topic_send ON realtime.messages
FOR INSERT TO authenticated
WITH CHECK (
  CASE
    WHEN (SELECT realtime.topic()) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND split_part((SELECT realtime.topic()), ':', 3) = (SELECT auth.uid())::text
    WHEN (SELECT realtime.topic()) ~ '^presence:conversation:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_is_conversation_participant(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.id::text = split_part((SELECT realtime.topic()), ':', 3)
          AND app_private.nb_project_can_read(task.project_id)
      )
    WHEN (SELECT realtime.topic()) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.nb_project_can_read(split_part((SELECT realtime.topic()), ':', 2)::uuid)
    ELSE FALSE
  END
);
