ALTER TABLE IF EXISTS "connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "project_nodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "project_file_index" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "project_node_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "project_node_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "onboarding_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "onboarding_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "onboarding_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "profile_audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view all profiles" ON "profiles";
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON "profiles";
DROP POLICY IF EXISTS "Profiles are viewable by allowed users" ON "profiles";
CREATE POLICY "Profiles are viewable by allowed users"
ON "profiles" FOR SELECT
USING (
  auth.uid() = id
  OR visibility = 'public'
  OR (
    visibility = 'connections'
    AND EXISTS (
      SELECT 1
      FROM "connections" c
      WHERE c.status = 'accepted'
        AND (
          (c.requester_id = auth.uid() AND c.addressee_id = "profiles"."id")
          OR (c.addressee_id = auth.uid() AND c.requester_id = "profiles"."id")
        )
    )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can insert own profile" ON "profiles";
CREATE POLICY "Users can insert own profile"
ON "profiles" FOR INSERT
WITH CHECK (auth.uid() = id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own profile" ON "profiles";
CREATE POLICY "Users can update own profile"
ON "profiles" FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view own connections" ON "connections";
CREATE POLICY "Users can view own connections"
ON "connections" FOR SELECT
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can create connection requests" ON "connections";
CREATE POLICY "Users can create connection requests"
ON "connections" FOR INSERT
WITH CHECK (auth.uid() = requester_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own connections" ON "connections";
CREATE POLICY "Users can update own connections"
ON "connections" FOR UPDATE
USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'posts'
  ) THEN
    EXECUTE 'ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Public posts are viewable by everyone" ON "posts"';
    EXECUTE $policy$
      CREATE POLICY "Public posts are viewable by everyone"
      ON "posts" FOR SELECT
      USING (visibility = ''public'' OR author_id = auth.uid())
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS "Users can create own posts" ON "posts"';
    EXECUTE $policy$
      CREATE POLICY "Users can create own posts"
      ON "posts" FOR INSERT
      WITH CHECK (auth.uid() = author_id)
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own posts" ON "posts"';
    EXECUTE $policy$
      CREATE POLICY "Users can update own posts"
      ON "posts" FOR UPDATE
      USING (auth.uid() = author_id)
      WITH CHECK (auth.uid() = author_id)
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete own posts" ON "posts"';
    EXECUTE $policy$
      CREATE POLICY "Users can delete own posts"
      ON "posts" FOR DELETE
      USING (auth.uid() = author_id)
    $policy$;
  END IF;
END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS "Public projects are viewable by everyone" ON "projects";
CREATE POLICY "Public projects are viewable by everyone"
ON "projects" FOR SELECT
USING (visibility = 'public' OR owner_id = auth.uid());
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can create own projects" ON "projects";
CREATE POLICY "Users can create own projects"
ON "projects" FOR INSERT
WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own projects" ON "projects";
CREATE POLICY "Users can update own projects"
ON "projects" FOR UPDATE
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Project members are viewable" ON "project_members";
CREATE POLICY "Project members are viewable"
ON "project_members" FOR SELECT
USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS project_nodes_read ON "project_nodes";
CREATE POLICY project_nodes_read
ON "project_nodes" FOR SELECT
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM "project_members" m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_nodes_public_read ON "project_nodes";
CREATE POLICY project_nodes_public_read
ON "project_nodes" FOR SELECT
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.visibility = 'public')
  AND deleted_at IS NULL
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_nodes_write ON "project_nodes";
CREATE POLICY project_nodes_write
ON "project_nodes" FOR ALL
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_file_index_read ON "project_file_index";
CREATE POLICY project_file_index_read
ON "project_file_index" FOR SELECT
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM "project_members" m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_file_index_public_read ON "project_file_index";
CREATE POLICY project_file_index_public_read
ON "project_file_index" FOR SELECT
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.visibility = 'public')
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_file_index_write ON "project_file_index";
CREATE POLICY project_file_index_write
ON "project_file_index" FOR ALL
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_node_locks_read ON "project_node_locks";
CREATE POLICY project_node_locks_read
ON "project_node_locks" FOR SELECT
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM "project_members" m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_node_locks_write ON "project_node_locks";
CREATE POLICY project_node_locks_write
ON "project_node_locks" FOR ALL
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_node_events_read ON "project_node_events";
CREATE POLICY project_node_events_read
ON "project_node_events" FOR SELECT
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM "project_members" m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_node_events_write ON "project_node_events";
CREATE POLICY project_node_events_write
ON "project_node_events" FOR ALL
USING (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM "projects" p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM "project_members" m
    WHERE m.project_id = project_id
      AND m.user_id = auth.uid()
      AND m.role <> 'viewer'
  )
);
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-files', 'project-files', false, 10485760)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;
--> statement-breakpoint
DROP POLICY IF EXISTS project_files_read ON storage.objects;
CREATE POLICY project_files_read
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM "projects" p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM "project_members" m
      WHERE m.project_id::text = split_part(name, '/', 2)
        AND m.user_id = auth.uid()
    )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_files_public_read ON storage.objects;
CREATE POLICY project_files_public_read
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND EXISTS (
    SELECT 1 FROM "projects" p
    WHERE p.id::text = split_part(name, '/', 2)
      AND p.visibility = 'public'
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS project_files_write ON storage.objects;
CREATE POLICY project_files_write
ON storage.objects FOR ALL
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM "projects" p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM "project_members" m
      WHERE m.project_id::text = split_part(name, '/', 2)
        AND m.user_id = auth.uid()
        AND m.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM "projects" p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM "project_members" m
      WHERE m.project_id::text = split_part(name, '/', 2)
        AND m.user_id = auth.uid()
        AND m.role <> 'viewer'
    )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can manage own onboarding drafts" ON "onboarding_drafts";
CREATE POLICY "Users can manage own onboarding drafts"
ON "onboarding_drafts" FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view own onboarding submissions" ON "onboarding_submissions";
CREATE POLICY "Users can view own onboarding submissions"
ON "onboarding_submissions" FOR SELECT
USING (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can create own onboarding submissions" ON "onboarding_submissions";
CREATE POLICY "Users can create own onboarding submissions"
ON "onboarding_submissions" FOR INSERT
WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own onboarding submissions" ON "onboarding_submissions";
CREATE POLICY "Users can update own onboarding submissions"
ON "onboarding_submissions" FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view own onboarding events" ON "onboarding_events";
CREATE POLICY "Users can view own onboarding events"
ON "onboarding_events" FOR SELECT
USING (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view own profile audit events" ON "profile_audit_events";
CREATE POLICY "Users can view own profile audit events"
ON "profile_audit_events" FOR SELECT
USING (auth.uid() = user_id);
