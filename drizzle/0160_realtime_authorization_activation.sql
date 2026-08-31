-- Activate the private Realtime topic contract independently of the broader
-- Storage alignment migration so partially applied environments fail closed.
-- Supabase owns realtime.messages and enables RLS on it by default. Managed
-- projects allow policy management, but intentionally reject ALTER TABLE.

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
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members viewer
      JOIN public.project_members target
        ON target.project_id = viewer.project_id
      WHERE viewer.user_id = (SELECT auth.uid())
        AND target.user_id = p_target_user_id
    );
$$;

REVOKE ALL ON FUNCTION app_private.nb_can_observe_user_presence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.nb_can_observe_user_presence(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS application_topic_read ON realtime.messages;
DROP POLICY IF EXISTS application_topic_send ON realtime.messages;

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
