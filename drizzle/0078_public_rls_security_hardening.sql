-- ============================================================================
-- Public schema RLS hardening
--
-- Supabase advisors flagged public tables/partitions with RLS disabled and
-- sensitive-looking columns exposed through broad API grants. This migration
-- makes RLS coverage migration-backed, removes stale permissive profile access,
-- and restores the intended browser-facing policies for tables that are read
-- directly through Supabase.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nb_is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = auth.uid()
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_project_can_read(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.visibility = 'public'
        OR p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = auth.uid()
        )
      )
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_project_can_write(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = auth.uid()
            AND pm.role IN ('owner', 'admin', 'member')
        )
      )
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_project_can_admin(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = auth.uid()
            AND pm.role IN ('owner', 'admin')
        )
      )
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_collection_can_manage(p_collection_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collections c
    WHERE c.id = p_collection_id
      AND c.owner_id = auth.uid()
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_project_public_readme_visible(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_readme_version_is_public(p_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_readme_versions v
    JOIN public.project_readmes r
      ON r.project_id = v.project_id
     AND r.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND public.nb_project_public_readme_visible(v.project_id)
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nb_readme_asset_is_public(p_asset_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_readme_assets a
    WHERE a.id = p_asset_id
      AND a.deleted_at IS NULL
      AND a.status = 'published'
      AND public.nb_project_public_readme_visible(a.project_id)
      AND (
        a.version_id IS NULL
        OR public.nb_readme_version_is_public(a.version_id)
      )
  );
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_is_conversation_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_is_conversation_participant(uuid) TO anon, authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_project_can_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_project_can_read(uuid) TO anon, authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_project_can_write(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_project_can_write(uuid) TO authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_project_can_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_project_can_admin(uuid) TO authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_collection_can_manage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_collection_can_manage(uuid) TO authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_project_public_readme_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_project_public_readme_visible(uuid) TO anon, authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_readme_version_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_readme_version_is_public(uuid) TO anon, authenticated;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.nb_readme_asset_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nb_readme_asset_is_public(uuid) TO anon, authenticated;
--> statement-breakpoint

DO $$
DECLARE
  rel regclass;
BEGIN
  FOR rel IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND (
        c.relname = ANY (ARRAY[
          'account_deletions',
          'attachment_uploads',
          'collection_projects',
          'collections',
          'connection_suggestion_dismissals',
          'connection_suggestions',
          'conversation_participants',
          'conversations',
          'dm_pairs',
          'interests',
          'job_heartbeats',
          'message_attachments',
          'message_edit_logs',
          'message_hidden_for_users',
          'messages',
          'notification_deliveries',
          'profile_counters',
          'profile_interests',
          'profile_skills',
          'profiles',
          'project_follows',
          'project_node_events',
          'project_open_roles',
          'project_readme_assets',
          'project_readme_draft_contributors',
          'project_readme_versions',
          'project_readmes',
          'project_run_diagnostics',
          'project_run_logs',
          'project_run_profiles',
          'project_run_sessions',
          'project_skills',
          'project_sprints',
          'project_tags',
          'push_subscriptions',
          'reserved_usernames',
          'role_applications',
          'saved_projects',
          'skills',
          'tags',
          'task_comment_likes',
          'task_comments',
          'task_node_links',
          'task_subtasks',
          'tasks',
          'username_aliases'
        ])
        OR c.relname LIKE 'project_node_events\_%'
        OR c.relname LIKE 'project_run_logs\_%'
        OR c.relname LIKE 'project_run_diagnostics\_%'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
  END LOOP;
END $$;
--> statement-breakpoint

ALTER FUNCTION public.enforce_profile_username_rules() SECURITY DEFINER;
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by allowed users" ON public.profiles;
CREATE POLICY "Profiles are viewable by allowed users"
ON public.profiles FOR SELECT
USING (
  deleted_at IS NULL
  AND (
    auth.uid() = id
    OR visibility = 'public'
    OR (
      visibility = 'connections'
      AND EXISTS (
        SELECT 1
        FROM public.connections c
        WHERE c.status = 'accepted'
          AND (
            (c.requester_id = auth.uid() AND c.addressee_id = public.profiles.id)
            OR (c.addressee_id = auth.uid() AND c.requester_id = public.profiles.id)
          )
      )
    )
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id AND deleted_at IS NULL)
WITH CHECK (auth.uid() = id);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view own username aliases" ON public.username_aliases;
CREATE POLICY "Users can view own username aliases"
ON public.username_aliases FOR SELECT
USING (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage own username aliases" ON public.username_aliases;
CREATE POLICY "Users can manage own username aliases"
ON public.username_aliases FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view own profile counters" ON public.profile_counters;
CREATE POLICY "Users can view own profile counters"
ON public.profile_counters FOR SELECT
USING (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view own connection suggestions" ON public.connection_suggestions;
CREATE POLICY "Users can view own connection suggestions"
ON public.connection_suggestions FOR SELECT
USING (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their dismissals" ON public.connection_suggestion_dismissals;
DROP POLICY IF EXISTS "Users can manage their connection dismissals" ON public.connection_suggestion_dismissals;
CREATE POLICY "Users can manage their connection dismissals"
ON public.connection_suggestion_dismissals FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can view conversations they are part of" ON public.conversations;
CREATE POLICY "Users can view conversations they are part of"
ON public.conversations FOR SELECT
USING (public.nb_is_conversation_participant(id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
ON public.conversations FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view participants of their conversations" ON public.conversation_participants;
CREATE POLICY "Users can view participants of their conversations"
ON public.conversation_participants FOR SELECT
USING (
  user_id = auth.uid()
  OR public.nb_is_conversation_participant(conversation_id)
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can add themselves to conversations" ON public.conversation_participants;
CREATE POLICY "Users can add themselves to conversations"
ON public.conversation_participants FOR INSERT
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can update their participation" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can manage their own participant state" ON public.conversation_participants;
CREATE POLICY "Users can manage their own participant state"
ON public.conversation_participants FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view DM pairs they are part of" ON public.dm_pairs;
CREATE POLICY "Users can view DM pairs they are part of"
ON public.dm_pairs FOR SELECT
USING (user_low = auth.uid() OR user_high = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations"
ON public.messages FOR SELECT
USING (
  deleted_at IS NULL
  AND public.nb_is_conversation_participant(conversation_id)
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can insert their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
ON public.messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND public.nb_is_conversation_participant(conversation_id)
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages"
ON public.messages FOR UPDATE
USING (sender_id = auth.uid() AND deleted_at IS NULL)
WITH CHECK (sender_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON public.message_attachments;
CREATE POLICY "Users can view attachments in their conversations"
ON public.message_attachments FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = message_id
      AND public.nb_is_conversation_participant(m.conversation_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can add attachments to their messages" ON public.message_attachments;
CREATE POLICY "Users can add attachments to their messages"
ON public.message_attachments FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = message_id
      AND m.sender_id = auth.uid()
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view message edit logs in their conversations" ON public.message_edit_logs;
CREATE POLICY "Users can view message edit logs in their conversations"
ON public.message_edit_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = message_id
      AND public.nb_is_conversation_participant(m.conversation_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own message hidden state" ON public.message_hidden_for_users;
CREATE POLICY "Users can manage their own message hidden state"
ON public.message_hidden_for_users FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own uploads" ON public.attachment_uploads;
CREATE POLICY "Users can manage their own uploads"
ON public.attachment_uploads FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Tasks are viewable by project members or if public" ON public.tasks;
CREATE POLICY "Tasks are viewable by project members or if public"
ON public.tasks FOR SELECT
USING (deleted_at IS NULL AND public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Task writers can manage tasks" ON public.tasks;
CREATE POLICY "Task writers can manage tasks"
ON public.tasks FOR ALL
USING (deleted_at IS NULL AND public.nb_project_can_write(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Subtasks are viewable like tasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "Users can view subtasks of tasks they can access" ON public.task_subtasks;
CREATE POLICY "Subtasks are viewable like tasks"
ON public.task_subtasks FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND t.deleted_at IS NULL
      AND public.nb_project_can_read(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Task writers can manage subtasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "Members can create subtasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "Members can update subtasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "Members can delete subtasks" ON public.task_subtasks;
CREATE POLICY "Task writers can manage subtasks"
ON public.task_subtasks FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND public.nb_project_can_write(t.project_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND public.nb_project_can_write(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Task links are viewable like tasks" ON public.task_node_links;
CREATE POLICY "Task links are viewable like tasks"
ON public.task_node_links FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND t.deleted_at IS NULL
      AND public.nb_project_can_read(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Task writers can manage task links" ON public.task_node_links;
CREATE POLICY "Task writers can manage task links"
ON public.task_node_links FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND public.nb_project_can_write(t.project_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND public.nb_project_can_write(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Comments are viewable by users who can see the task" ON public.task_comments;
DROP POLICY IF EXISTS "Users can view comments of tasks they can access" ON public.task_comments;
CREATE POLICY "Comments are viewable by users who can see the task"
ON public.task_comments FOR SELECT
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND t.deleted_at IS NULL
      AND public.nb_project_can_read(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own comments" ON public.task_comments;
DROP POLICY IF EXISTS "Members can create comments" ON public.task_comments;
DROP POLICY IF EXISTS "Comment owners can update their own comments" ON public.task_comments;
CREATE POLICY "Users can manage their own comments"
ON public.task_comments FOR ALL
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_id
      AND public.nb_project_can_read(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Likes are viewable by users who can see the comment task" ON public.task_comment_likes;
DROP POLICY IF EXISTS "Users can view comment likes" ON public.task_comment_likes;
CREATE POLICY "Likes are viewable by users who can see the comment task"
ON public.task_comment_likes FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.task_comments tc
    JOIN public.tasks t ON t.id = tc.task_id
    WHERE tc.id = comment_id
      AND tc.deleted_at IS NULL
      AND t.deleted_at IS NULL
      AND public.nb_project_can_read(t.project_id)
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own likes" ON public.task_comment_likes;
DROP POLICY IF EXISTS "Users can create their own likes" ON public.task_comment_likes;
DROP POLICY IF EXISTS "Users can delete their own likes" ON public.task_comment_likes;
CREATE POLICY "Users can manage their own likes"
ON public.task_comment_likes FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Sprints are viewable like projects" ON public.project_sprints;
DROP POLICY IF EXISTS "Sprints are viewable by project members or if public" ON public.project_sprints;
CREATE POLICY "Sprints are viewable by project members or if public"
ON public.project_sprints FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project writers can manage sprints" ON public.project_sprints;
DROP POLICY IF EXISTS "Project admins can manage sprints" ON public.project_sprints;
CREATE POLICY "Project writers can manage sprints"
ON public.project_sprints FOR ALL
USING (public.nb_project_can_write(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Follows are public" ON public.project_follows;
CREATE POLICY "Follows are public"
ON public.project_follows FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own follows" ON public.project_follows;
DROP POLICY IF EXISTS "Users can manage their project follows" ON public.project_follows;
CREATE POLICY "Users can manage their project follows"
ON public.project_follows FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own saves" ON public.saved_projects;
DROP POLICY IF EXISTS "Users can manage their saved projects" ON public.saved_projects;
CREATE POLICY "Users can manage their saved projects"
ON public.saved_projects FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view public collections or their own" ON public.collections;
CREATE POLICY "Users can view own collections"
ON public.collections FOR SELECT
USING (owner_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage their own collections" ON public.collections;
CREATE POLICY "Users can manage their own collections"
ON public.collections FOR ALL
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view projects in public collections or their own" ON public.collection_projects;
CREATE POLICY "Users can view own collection projects"
ON public.collection_projects FOR SELECT
USING (public.nb_collection_can_manage(collection_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage projects in their collections" ON public.collection_projects;
CREATE POLICY "Users can manage projects in their collections"
ON public.collection_projects FOR ALL
USING (public.nb_collection_can_manage(collection_id))
WITH CHECK (public.nb_collection_can_manage(collection_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Open roles are viewable by everyone" ON public.project_open_roles;
DROP POLICY IF EXISTS "Open roles are viewable like projects" ON public.project_open_roles;
CREATE POLICY "Open roles are viewable by project visibility"
ON public.project_open_roles FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project owners can manage open roles" ON public.project_open_roles;
DROP POLICY IF EXISTS "Project admins can manage open roles" ON public.project_open_roles;
CREATE POLICY "Project admins can manage open roles"
ON public.project_open_roles FOR ALL
USING (public.nb_project_can_admin(project_id))
WITH CHECK (public.nb_project_can_admin(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view their own applications or project owner can view all" ON public.role_applications;
DROP POLICY IF EXISTS "Users can view applications for their projects or their own" ON public.role_applications;
CREATE POLICY "Users can view applications for their projects or their own"
ON public.role_applications FOR SELECT
USING (applicant_id = auth.uid() OR public.nb_project_can_admin(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can apply" ON public.role_applications;
DROP POLICY IF EXISTS "Users can create their own applications" ON public.role_applications;
CREATE POLICY "Users can create their own applications"
ON public.role_applications FOR INSERT
WITH CHECK (applicant_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Project owners can update applications" ON public.role_applications;
DROP POLICY IF EXISTS "Users can update their own applications or project admins can manage" ON public.role_applications;
CREATE POLICY "Users can update their own applications or project admins can manage"
ON public.role_applications FOR UPDATE
USING (applicant_id = auth.uid() OR public.nb_project_can_admin(project_id))
WITH CHECK (applicant_id = auth.uid() OR public.nb_project_can_admin(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Run profiles are viewable by members" ON public.project_run_profiles;
DROP POLICY IF EXISTS "Project runners can view run profiles" ON public.project_run_profiles;
CREATE POLICY "Project runners can view run profiles"
ON public.project_run_profiles FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project writers can manage run profiles" ON public.project_run_profiles;
DROP POLICY IF EXISTS "Project runners can manage run profiles" ON public.project_run_profiles;
CREATE POLICY "Project runners can manage run profiles"
ON public.project_run_profiles FOR ALL
USING (public.nb_project_can_write(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project owners can manage sessions" ON public.project_run_sessions;
DROP POLICY IF EXISTS "Project runners can view sessions" ON public.project_run_sessions;
DROP POLICY IF EXISTS "Project runners can manage sessions" ON public.project_run_sessions;
CREATE POLICY "Project runners can manage sessions"
ON public.project_run_sessions FOR ALL
USING (public.nb_project_can_read(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project owners can manage logs" ON public.project_run_logs;
DROP POLICY IF EXISTS "Project runners can view run logs" ON public.project_run_logs;
DROP POLICY IF EXISTS "Project runners can insert run logs" ON public.project_run_logs;
CREATE POLICY "Project runners can view run logs"
ON public.project_run_logs FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

CREATE POLICY "Project runners can insert run logs"
ON public.project_run_logs FOR INSERT
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project owners can manage diagnostics" ON public.project_run_diagnostics;
DROP POLICY IF EXISTS "Project runners can view run diagnostics" ON public.project_run_diagnostics;
DROP POLICY IF EXISTS "Project runners can insert run diagnostics" ON public.project_run_diagnostics;
CREATE POLICY "Project runners can view run diagnostics"
ON public.project_run_diagnostics FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

CREATE POLICY "Project runners can insert run diagnostics"
ON public.project_run_diagnostics FOR INSERT
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Taxonomy tables are publicly readable" ON public.interests;
CREATE POLICY "Interests are publicly readable"
ON public.interests FOR SELECT
USING (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "Taxonomy tables are publicly readable" ON public.skills;
CREATE POLICY "Skills are publicly readable"
ON public.skills FOR SELECT
USING (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "Taxonomy tables are publicly readable" ON public.tags;
CREATE POLICY "Tags are publicly readable"
ON public.tags FOR SELECT
USING (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage own profile interests" ON public.profile_interests;
CREATE POLICY "Users can manage own profile interests"
ON public.profile_interests FOR ALL
USING (profile_id = auth.uid())
WITH CHECK (profile_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage own profile skills" ON public.profile_skills;
CREATE POLICY "Users can manage own profile skills"
ON public.profile_skills FOR ALL
USING (profile_id = auth.uid())
WITH CHECK (profile_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Project skills viewable by everyone" ON public.project_skills;
CREATE POLICY "Project skills viewable by project visibility"
ON public.project_skills FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Project tags viewable by everyone" ON public.project_tags;
CREATE POLICY "Project tags viewable by project visibility"
ON public.project_tags FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can manage own push subscriptions"
ON public.push_subscriptions FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can manage own notifications" ON public.notification_deliveries;
CREATE POLICY "Users can view own notification deliveries"
ON public.notification_deliveries FOR SELECT
USING (user_id = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "Readmes viewable by public" ON public.project_readmes;
CREATE POLICY "Readmes viewable by project members"
ON public.project_readmes FOR SELECT
USING (public.nb_project_can_read(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Readmes writable by project writers" ON public.project_readmes;
CREATE POLICY "Readmes writable by project writers"
ON public.project_readmes FOR ALL
USING (public.nb_project_can_write(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('public.project_readme_draft_contributors') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Readme draft contributors visible to project members" ON public.project_readme_draft_contributors;
    CREATE POLICY "Readme draft contributors visible to project members"
    ON public.project_readme_draft_contributors FOR SELECT
    USING (public.nb_project_can_read(project_id));

    DROP POLICY IF EXISTS "Readme draft contributors writable by project writers" ON public.project_readme_draft_contributors;
    CREATE POLICY "Readme draft contributors writable by project writers"
    ON public.project_readme_draft_contributors FOR ALL
    USING (public.nb_project_can_write(project_id))
    WITH CHECK (public.nb_project_can_write(project_id));
  END IF;
END $$;
--> statement-breakpoint

DROP POLICY IF EXISTS "Readme versions viewable by public" ON public.project_readme_versions;
CREATE POLICY "Readme versions viewable by visibility"
ON public.project_readme_versions FOR SELECT
USING (
  public.nb_project_can_read(project_id)
  OR public.nb_readme_version_is_public(id)
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Readme versions writable by project writers" ON public.project_readme_versions;
CREATE POLICY "Readme versions writable by project writers"
ON public.project_readme_versions FOR ALL
USING (public.nb_project_can_write(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Readme assets viewable by public" ON public.project_readme_assets;
CREATE POLICY "Readme assets viewable by visibility"
ON public.project_readme_assets FOR SELECT
USING (
  public.nb_project_can_read(project_id)
  OR public.nb_readme_asset_is_public(id)
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Readme assets writable by project writers" ON public.project_readme_assets;
CREATE POLICY "Readme assets writable by project writers"
ON public.project_readme_assets FOR ALL
USING (public.nb_project_can_write(project_id))
WITH CHECK (public.nb_project_can_write(project_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can view own account deletions" ON public.account_deletions;
CREATE POLICY "Users can view own account deletions"
ON public.account_deletions FOR SELECT
USING (user_id = auth.uid());
--> statement-breakpoint
