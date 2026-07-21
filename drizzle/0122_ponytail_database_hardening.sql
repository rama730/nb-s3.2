-- Ponytail database hardening: fix authorization defects first, then remove
-- redundant policy/index/function/schema surface. Historical migrations stay immutable.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;

-- RLS helpers belong outside the API-exposed public schema. ALTER preserves
-- policy dependencies by OID; the definitions below pin an empty search path.
ALTER FUNCTION public.get_auth_uid() SET SCHEMA app_private;
ALTER FUNCTION public.nb_collection_can_manage(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_is_conversation_participant(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_project_can_admin(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_project_can_read(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_project_can_write(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_project_public_readme_visible(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_readme_asset_is_public(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.nb_readme_version_is_public(uuid) SET SCHEMA app_private;

CREATE OR REPLACE FUNCTION app_private.get_auth_uid()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_private.nb_collection_can_manage(p_collection_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collections c
    WHERE c.id = p_collection_id
      AND c.owner_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_project_can_admin(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_project_can_read(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.visibility = 'public'
        OR p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_project_can_write(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin', 'member')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_project_public_readme_visible(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
      AND COALESCE(p.public_tab_visibility ->> 'readme', 'true') = 'true'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_readme_version_is_public(p_version_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_markdown_versions v
    JOIN public.project_markdowns m
      ON m.id = v.markdown_id
     AND m.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND COALESCE(m.settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
      AND app_private.nb_project_public_readme_visible(v.project_id)
  );
$$;

CREATE OR REPLACE FUNCTION app_private.nb_readme_asset_is_public(p_asset_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_markdown_assets a
    JOIN public.project_markdowns m ON m.id = a.markdown_id
    WHERE a.id = p_asset_id
      AND a.deleted_at IS NULL
      AND a.status = 'published'
      AND COALESCE(m.settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
      AND app_private.nb_project_public_readme_visible(a.project_id)
      AND (
        a.version_id IS NULL
        OR app_private.nb_readme_version_is_public(a.version_id)
      )
  );
$$;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_auth_uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_collection_can_manage(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_is_conversation_participant(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_project_can_admin(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_project_can_read(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_project_can_write(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_project_public_readme_visible(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_readme_asset_is_public(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nb_readme_version_is_public(uuid) TO anon, authenticated, service_role;

-- Correct the seven cross-project policy checks. Read policies preserve their
-- original private-member semantics; public project reads remain separate.
ALTER POLICY project_file_index_read ON public.project_file_index
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_file_index.project_id
      AND p.deleted_at IS NULL
      AND p.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_file_index.project_id
      AND m.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY project_file_index_write ON public.project_file_index
USING (app_private.nb_project_can_write(project_id))
WITH CHECK (app_private.nb_project_can_write(project_id));

ALTER POLICY project_node_events_read ON public.project_node_events
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_node_events.project_id
      AND p.deleted_at IS NULL
      AND p.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_node_events.project_id
      AND m.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY project_node_events_write ON public.project_node_events
USING (app_private.nb_project_can_write(project_id))
WITH CHECK (app_private.nb_project_can_write(project_id));

ALTER POLICY project_node_locks_read ON public.project_node_locks
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_node_locks.project_id
      AND p.deleted_at IS NULL
      AND p.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_node_locks.project_id
      AND m.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY project_nodes_read ON public.project_nodes
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_nodes.project_id
      AND p.deleted_at IS NULL
      AND p.owner_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_nodes.project_id
      AND m.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY project_nodes_write ON public.project_nodes
USING (app_private.nb_project_can_write(project_id))
WITH CHECK (app_private.nb_project_can_write(project_id));

DROP POLICY IF EXISTS "Project members are viewable" ON public.project_members;
CREATE POLICY "Project members follow project visibility"
ON public.project_members FOR SELECT TO anon, authenticated
USING (app_private.nb_project_can_read(project_id));

-- Remove broad object-listing and cross-project Storage access. Public buckets
-- remain directly downloadable; database listing stays authorization-scoped.
DROP POLICY IF EXISTS "Allow all for authenticated users vmqls3_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow all for authenticated users vmqls3_1" ON storage.objects;
DROP POLICY IF EXISTS "Allow all for authenticated users vmqls3_2" ON storage.objects;
DROP POLICY IF EXISTS "Allow all for authenticated users vmqls3_3" ON storage.objects;
DROP POLICY IF EXISTS "Full access for authenticated users vmqls3_0" ON storage.objects;
DROP POLICY IF EXISTS "Full access for authenticated users vmqls3_1" ON storage.objects;
DROP POLICY IF EXISTS "Full access for authenticated users vmqls3_2" ON storage.objects;
DROP POLICY IF EXISTS "Full access for authenticated users vmqls3_3" ON storage.objects;
DROP POLICY IF EXISTS project_files_public_read ON storage.objects;
DROP POLICY IF EXISTS project_files_read ON storage.objects;
DROP POLICY IF EXISTS project_files_write ON storage.objects;

CREATE POLICY project_files_select ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.visibility = 'public'
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY project_files_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
        AND m.role <> 'viewer'
    )
  )
);

CREATE POLICY project_files_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
        AND m.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
        AND m.role <> 'viewer'
    )
  )
);

CREATE POLICY project_files_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
        AND m.role <> 'viewer'
    )
  )
);

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Avatar owner delete" ON storage.objects;
DROP POLICY IF EXISTS "Avatar owner update" ON storage.objects;
DROP POLICY IF EXISTS "Avatar owner upload" ON storage.objects;
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
DROP POLICY IF EXISTS "Avatars publicly viewable 1oj01fe_0" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update avatar 1oj01fe_0" ON storage.objects;
DROP POLICY IF EXISTS "Users can update avatar 1oj01fe_1" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload avatar 1oj01fe_0" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;

CREATE POLICY avatar_owner_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR split_part(name, '-', 1) = (SELECT auth.uid())::text
  )
);

CREATE POLICY avatar_owner_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR split_part(name, '-', 1) = (SELECT auth.uid())::text
  )
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR split_part(name, '-', 1) = (SELECT auth.uid())::text
  )
);

CREATE POLICY avatar_owner_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR split_part(name, '-', 1) = (SELECT auth.uid())::text
  )
);

DROP POLICY IF EXISTS "Users can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own attachments" ON storage.objects;
CREATE POLICY chat_attachments_owner_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
CREATE POLICY chat_attachments_owner_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS project_updates_media_public_read ON storage.objects;
DROP POLICY IF EXISTS project_updates_media_write ON storage.objects;
DROP POLICY IF EXISTS project_updates_media_delete ON storage.objects;
CREATE POLICY project_updates_media_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-updates-media'
  AND split_part(name, '/', 1) = 'projects'
  AND split_part(name, '/', 2) <> ''
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
        AND m.role <> 'viewer'
    )
  )
);
CREATE POLICY project_updates_media_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'project-updates-media'
  AND split_part(name, '/', 1) = 'projects'
  AND split_part(name, '/', 2) <> ''
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 2)
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = split_part(objects.name, '/', 2)
        AND m.user_id = (SELECT auth.uid())
        AND m.role <> 'viewer'
    )
  )
);

DROP POLICY IF EXISTS "Project members can upload task files" ON storage.objects;
DROP POLICY IF EXISTS "Project members can view task files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own task files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own task files" ON storage.objects;
CREATE POLICY task_files_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'task-files'
  AND (
    (SELECT auth.uid()) IN (
      SELECT pm.user_id FROM public.project_members pm
      WHERE pm.project_id = ((storage.foldername(objects.name))[1])::uuid
      UNION
      SELECT p.owner_id FROM public.projects p
      WHERE p.id = ((storage.foldername(objects.name))[1])::uuid
    )
  )
);
CREATE POLICY task_files_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'task-files'
  AND (
    (SELECT auth.uid()) IN (
      SELECT pm.user_id FROM public.project_members pm
      WHERE pm.project_id = ((storage.foldername(objects.name))[1])::uuid
      UNION
      SELECT p.owner_id FROM public.projects p
      WHERE p.id = ((storage.foldername(objects.name))[1])::uuid
    )
  )
);
CREATE POLICY task_files_update ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'task-files' AND owner = (SELECT auth.uid()))
WITH CHECK (bucket_id = 'task-files' AND owner = (SELECT auth.uid()));
CREATE POLICY task_files_delete ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'task-files' AND owner = (SELECT auth.uid()));

-- Split manage policies so they no longer overlap their explicit SELECT policy,
-- then merge equivalent permissive reads into one OR expression per table.
DO $policy_cleanup$
DECLARE
  target_table text;
  policy_row record;
  select_expr text;
  authenticated_only constant text[] := ARRAY[
    'collection_projects',
    'collections',
    'project_markdown_draft_contributors',
    'project_node_events',
    'username_aliases'
  ];
  target_tables constant text[] := ARRAY[
    'collection_projects',
    'collections',
    'file_versions',
    'profile_collaboration_summaries',
    'profile_project_contribution_stages',
    'profile_project_contributions',
    'project_file_index',
    'project_follows',
    'project_markdown_assets',
    'project_markdown_draft_contributors',
    'project_markdown_versions',
    'project_markdowns',
    'project_node_events',
    'project_nodes',
    'project_open_roles',
    'project_sprints',
    'task_comment_likes',
    'task_comments',
    'task_node_links',
    'task_subtasks',
    'tasks',
    'username_aliases'
  ];
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    FOR policy_row IN
      SELECT
        p.polname,
        pg_get_expr(p.polqual, p.polrelid) AS using_expr,
        pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = target_table
        AND p.polcmd = '*'
        AND p.polpermissive
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.polname, target_table);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
        policy_row.polname || ' insert',
        target_table,
        COALESCE(policy_row.check_expr, policy_row.using_expr, 'false')
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
        policy_row.polname || ' update',
        target_table,
        COALESCE(policy_row.using_expr, 'false'),
        COALESCE(policy_row.check_expr, policy_row.using_expr, 'false')
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
        policy_row.polname || ' delete',
        target_table,
        COALESCE(policy_row.using_expr, 'false')
      );
    END LOOP;

    SELECT string_agg(format('(%s)', pg_get_expr(p.polqual, p.polrelid)), ' OR ' ORDER BY p.polname)
    INTO select_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = target_table
      AND p.polcmd = 'r'
      AND p.polpermissive;

    IF select_expr IS NOT NULL THEN
      FOR policy_row IN
        SELECT p.polname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = target_table
          AND p.polcmd = 'r'
          AND p.polpermissive
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', policy_row.polname, target_table);
      END LOOP;

      IF target_table = ANY(authenticated_only) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
          'ponytail_select_' || target_table,
          target_table,
          select_expr
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (%s)',
          'ponytail_select_' || target_table,
          target_table,
          select_expr
        );
      END IF;
    END IF;
  END LOOP;
END
$policy_cleanup$;

-- Cache request-claim functions once per statement instead of per row.
DO $auth_initplan$
DECLARE
  policy_row record;
  using_expr text;
  check_expr text;
  clauses text;
BEGIN
  FOR policy_row IN
    SELECT n.nspname, c.relname, p.polname, p.polrelid, p.polqual, p.polwithcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'storage')
  LOOP
    using_expr := pg_get_expr(policy_row.polqual, policy_row.polrelid);
    check_expr := pg_get_expr(policy_row.polwithcheck, policy_row.polrelid);

    IF using_expr IS NOT NULL THEN
      using_expr := regexp_replace(using_expr, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'gi');
      using_expr := regexp_replace(using_expr, '(?<!SELECT )auth\.role\(\)', '(SELECT auth.role())', 'gi');
      using_expr := regexp_replace(using_expr, '(?<!SELECT )auth\.jwt\(\)', '(SELECT auth.jwt())', 'gi');
    END IF;
    IF check_expr IS NOT NULL THEN
      check_expr := regexp_replace(check_expr, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'gi');
      check_expr := regexp_replace(check_expr, '(?<!SELECT )auth\.role\(\)', '(SELECT auth.role())', 'gi');
      check_expr := regexp_replace(check_expr, '(?<!SELECT )auth\.jwt\(\)', '(SELECT auth.jwt())', 'gi');
    END IF;

    clauses := '';
    IF using_expr IS NOT NULL THEN
      clauses := clauses || format(' USING (%s)', using_expr);
    END IF;
    IF check_expr IS NOT NULL THEN
      clauses := clauses || format(' WITH CHECK (%s)', check_expr);
    END IF;
    IF clauses <> '' THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I%s',
        policy_row.polname,
        policy_row.nspname,
        policy_row.relname,
        clauses
      );
    END IF;
  END LOOP;
END
$auth_initplan$;

-- Trigger/maintenance functions are not RPCs. Pin their paths and remove all
-- browser-role execution grants.
CREATE OR REPLACE FUNCTION public.handle_message_insert_consistency()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preview_text text;
  preview_type text;
BEGIN
  preview_text := CASE
    WHEN jsonb_typeof(NEW.metadata->'structured') = 'object' THEN COALESCE(
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
      'Workflow update'
    )
    WHEN NULLIF(btrim(COALESCE(NEW.content, '')), '') IS NOT NULL THEN left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 160)
    WHEN NEW.type = 'image' THEN 'Photo'
    WHEN NEW.type = 'video' THEN 'Video'
    WHEN NEW.type = 'file' THEN 'Attachment'
    WHEN NEW.type = 'system' THEN 'System update'
    ELSE 'Message'
  END;
  preview_type := COALESCE(NULLIF(NEW.metadata #>> '{structured,kind}', ''), NEW.type, 'text');

  UPDATE public.conversations
  SET updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;

  UPDATE public.conversation_participants
  SET unread_count = unread_count + 1,
      last_message_at = NEW.created_at,
      last_message_id = NEW.id,
      last_message_preview = preview_text,
      last_message_type = preview_type,
      last_message_sender_id = NEW.sender_id,
      archived_at = NULL
  WHERE conversation_id = NEW.conversation_id
    AND (NEW.sender_id IS NULL OR user_id <> NEW.sender_id);

  IF NEW.sender_id IS NOT NULL THEN
    UPDATE public.conversation_participants
    SET unread_count = 0,
        last_message_at = NEW.created_at,
        last_message_id = NEW.id,
        last_message_preview = preview_text,
        last_message_type = preview_type,
        last_message_sender_id = NEW.sender_id,
        last_read_at = NEW.created_at,
        last_read_message_id = NEW.id,
        archived_at = NULL
    WHERE conversation_id = NEW.conversation_id
      AND user_id = NEW.sender_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_orphan_notifications()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  ref_key text;
  now_ts timestamptz := now();
BEGIN
  ref_key := TG_ARGV[0];
  UPDATE public.user_notifications
  SET dismissed_at = now_ts,
      read_at = COALESCE(read_at, now_ts),
      seen_at = COALESCE(seen_at, now_ts),
      updated_at = now_ts
  WHERE dismissed_at IS NULL
    AND entity_refs ->> ref_key = OLD.id::text;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_project_open_roles_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  p_id uuid;
BEGIN
  p_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  UPDATE public.projects
  SET open_roles_count = (
    SELECT count(*)
    FROM public.project_open_roles
    WHERE project_id = p_id AND filled < count
  )
  WHERE id = p_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_future_partitions()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  default_table constant text := 'project_node_events_default';
  month_offset integer;
  target_date date;
  part_name text;
  start_value text;
  end_value text;
  default_exists boolean;
  default_attached boolean;
BEGIN
  IF to_regclass('public.project_node_events') IS NULL THEN
    RETURN;
  END IF;

  default_exists := to_regclass('public.' || default_table) IS NOT NULL;
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_inherits i
    WHERE i.inhparent = 'public.project_node_events'::regclass
      AND i.inhrelid = to_regclass('public.' || default_table)
  ) INTO default_attached;

  IF default_attached THEN
    EXECUTE format('ALTER TABLE public.project_node_events DETACH PARTITION public.%I', default_table);
  END IF;

  BEGIN
    FOR month_offset IN 0..3 LOOP
      target_date := date_trunc('month', CURRENT_TIMESTAMP + (month_offset || ' month')::interval)::date;
      start_value := to_char(target_date, 'YYYY-MM-DD');
      end_value := to_char(target_date + interval '1 month', 'YYYY-MM-DD');
      part_name := 'project_node_events_' || to_char(target_date, 'YYYY_MM');

      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.project_node_events FOR VALUES FROM (%L) TO (%L)',
        part_name,
        start_value,
        end_value
      );

      IF default_exists THEN
        EXECUTE format(
          'WITH moved AS (
             DELETE FROM public.%I
             WHERE created_at >= %L::timestamptz AND created_at < %L::timestamptz
             RETURNING *
           ) INSERT INTO public.project_node_events SELECT * FROM moved',
          default_table,
          start_value,
          end_value
        );
      END IF;
    END LOOP;

    IF default_attached THEN
      EXECUTE format('ALTER TABLE public.project_node_events ATTACH PARTITION public.%I DEFAULT', default_table);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF default_attached THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.project_node_events ATTACH PARTITION public.%I DEFAULT', default_table);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Could not reattach % after partition creation failure', default_table;
      END;
    END IF;
    RAISE;
  END;
END;
$$;

ALTER FUNCTION public.allocate_project_node_event_sequence() SET search_path = '';
ALTER FUNCTION public.prevent_readme_delete() SET search_path = '';

DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON public.messages;
DROP FUNCTION IF EXISTS public.update_conversation_timestamp();
DROP FUNCTION IF EXISTS public.delete_auth_user(uuid);

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Cover the final application-owned foreign key, then delete exact duplicate indexes.
CREATE INDEX IF NOT EXISTS role_applications_applying_project_idx
ON public.role_applications (applying_project_id)
WHERE applying_project_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_connections_addressee;
DROP INDEX IF EXISTS public.idx_connections_requester;
DROP INDEX IF EXISTS public.project_file_index_project_idx;
DROP INDEX IF EXISTS public.project_follows_user_idx;
DROP INDEX IF EXISTS public.project_follows_project_idx;
DROP INDEX IF EXISTS public.project_members_user_idx;
DROP INDEX IF EXISTS public.idx_project_members_user_id;
DROP INDEX IF EXISTS public.idx_project_members_project_id;
DROP INDEX IF EXISTS public.project_members_project_idx;
DROP INDEX IF EXISTS public.project_node_locks_project_idx;
DROP INDEX IF EXISTS public.project_nodes_parent_idx;
DROP INDEX IF EXISTS public.project_nodes_project_idx;
DROP INDEX IF EXISTS public.project_nodes_created_by_idx;
DROP INDEX IF EXISTS public.project_nodes_deleted_by_idx;
DROP INDEX IF EXISTS public.idx_project_open_roles_project_id;
DROP INDEX IF EXISTS public.idx_project_sprints_project_id;
DROP INDEX IF EXISTS public.projects_owner_idx;
DROP INDEX IF EXISTS public.role_applications_decision_by_idx;
DROP INDEX IF EXISTS public.role_applications_role_id_idx;
DROP INDEX IF EXISTS public.saved_projects_user_idx;
DROP INDEX IF EXISTS public.task_node_links_task_idx;
DROP INDEX IF EXISTS public.task_node_links_created_by_idx;
DROP INDEX IF EXISTS public.task_node_links_node_idx;
DROP INDEX IF EXISTS public.task_subtasks_task_idx;
DROP INDEX IF EXISTS public.tasks_creator_idx;
DROP INDEX IF EXISTS public.tasks_sprint_idx;

-- Archive the retired runner data in the private schema, then remove its four
-- tables, partitions and enum. Also remove the empty task shadow hierarchy.
DO $retired_domains$
BEGIN
  IF to_regclass('public.project_run_profiles') IS NOT NULL THEN
    INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
    SELECT 'project_run_profiles', id::text, to_jsonb(row_data)
    FROM public.project_run_profiles AS row_data
    ON CONFLICT (source_table, source_key) DO NOTHING;
  END IF;
  IF to_regclass('public.project_run_sessions') IS NOT NULL THEN
    INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
    SELECT 'project_run_sessions', id::text, to_jsonb(row_data)
    FROM public.project_run_sessions AS row_data
    ON CONFLICT (source_table, source_key) DO NOTHING;
  END IF;
  IF to_regclass('public.project_run_logs') IS NOT NULL THEN
    INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
    SELECT 'project_run_logs', id::text || ':' || created_at::text, to_jsonb(row_data)
    FROM public.project_run_logs AS row_data
    ON CONFLICT (source_table, source_key) DO NOTHING;
  END IF;
  IF to_regclass('public.project_run_diagnostics') IS NOT NULL THEN
    INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
    SELECT 'project_run_diagnostics', id::text || ':' || created_at::text, to_jsonb(row_data)
    FROM public.project_run_diagnostics AS row_data
    ON CONFLICT (source_table, source_key) DO NOTHING;
  END IF;
  IF to_regclass('public.tasks_partitioned') IS NOT NULL THEN
    INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
    SELECT 'tasks_partitioned', id::text, to_jsonb(row_data)
    FROM public.tasks_partitioned AS row_data
    ON CONFLICT (source_table, source_key) DO NOTHING;
  END IF;
END
$retired_domains$;

DROP TABLE IF EXISTS public.project_run_diagnostics CASCADE;
DROP TABLE IF EXISTS public.project_run_logs CASCADE;
DROP TABLE IF EXISTS public.project_run_sessions CASCADE;
DROP TABLE IF EXISTS public.project_run_profiles CASCADE;
DROP TYPE IF EXISTS public.status_workflow;
DROP TABLE IF EXISTS public.tasks_partitioned CASCADE;

-- No live default or function references uuid_generate_*; pgcrypto owns UUID generation.
DROP EXTENSION IF EXISTS "uuid-ossp";
