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
USING (
    EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = project_members.project_id
        AND (p.visibility = 'public' OR p.owner_id = public.get_auth_uid())
    )
    OR EXISTS (
        SELECT 1 FROM project_members m
        WHERE m.project_id = project_members.project_id
        AND m.user_id = public.get_auth_uid()
    )
);
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
--> statement-breakpoint

-- project_updates_schema_repair_begin
ALTER TABLE "projects"
    ALTER COLUMN "public_tab_visibility" SET DEFAULT '{
        "dashboard": true,
        "readme": true,
        "updates": true,
        "files": true,
        "sprints": false,
        "tasks": false,
        "analytics": false
    }'::jsonb;
--> statement-breakpoint
UPDATE "projects"
SET "public_tab_visibility" = COALESCE("public_tab_visibility", '{}'::jsonb) || '{"updates": true}'::jsonb
WHERE NOT (COALESCE("public_tab_visibility", '{}'::jsonb) ? 'updates');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_updates" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
    "author_id" uuid REFERENCES "profiles"("id") ON DELETE set null,
    "content" text NOT NULL,
    "update_type" text,
    "visibility" text DEFAULT 'public' NOT NULL,
    "reply_policy" text DEFAULT 'logged_in' NOT NULL,
    "entity_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "media" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "like_count" integer DEFAULT 0 NOT NULL,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "deleted_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "project_updates_update_type_check" CHECK (
        "update_type" IS NULL OR "update_type" IN (
            'progress',
            'milestone',
            'release',
            'blocker',
            'decision',
            'collaboration_request',
            'behind_the_scenes'
        )
    ),
    CONSTRAINT "project_updates_visibility_check" CHECK ("visibility" IN ('public', 'members')),
    CONSTRAINT "project_updates_reply_policy_check" CHECK ("reply_policy" IN ('logged_in', 'members')),
    CONSTRAINT "project_updates_like_count_nonnegative" CHECK ("like_count" >= 0),
    CONSTRAINT "project_updates_comment_count_nonnegative" CHECK ("comment_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_updates_project_pinned_created_idx"
    ON "project_updates" ("project_id", "is_pinned", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_updates_project_created_active_idx"
    ON "project_updates" ("project_id", "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_updates_public_feed_idx"
    ON "project_updates" ("project_id", "visibility", "is_pinned", "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_updates_author_created_idx"
    ON "project_updates" ("author_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_updates_deleted_at_idx"
    ON "project_updates" ("deleted_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_update_likes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "update_id" uuid NOT NULL REFERENCES "project_updates"("id") ON DELETE cascade,
    "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_likes_update_idx"
    ON "project_update_likes" ("update_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_likes_user_idx"
    ON "project_update_likes" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_update_likes_unique"
    ON "project_update_likes" ("update_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_update_comments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "update_id" uuid NOT NULL REFERENCES "project_updates"("id") ON DELETE cascade,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
    "user_id" uuid REFERENCES "profiles"("id") ON DELETE set null,
    "content" text NOT NULL,
    "deleted_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_comments_update_created_idx"
    ON "project_update_comments" ("update_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_comments_update_active_idx"
    ON "project_update_comments" ("update_id", "created_at")
    WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_comments_project_created_idx"
    ON "project_update_comments" ("project_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_comments_user_created_idx"
    ON "project_update_comments" ("user_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "project_updates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_update_likes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_update_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "project_updates";
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "project_update_comments";
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS "Project updates are viewable by project access" ON "project_updates";
CREATE POLICY "Project updates are viewable by project access" ON "project_updates"
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_updates"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
              )
              OR (
                  p.visibility = 'public'
                  AND "project_updates"."visibility" = 'public'
                  AND (COALESCE(p.public_tab_visibility, '{}'::jsonb)->>'updates') IS DISTINCT FROM 'false'
              )
          )
    )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Project members can create updates" ON "project_updates";
CREATE POLICY "Project members can create updates" ON "project_updates"
FOR INSERT
WITH CHECK (
    author_id = auth.uid()
    AND deleted_at IS NULL
    AND EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_updates"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
                    AND m.role IN ('owner', 'admin', 'member')
              )
          )
    )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Authors and admins can manage updates" ON "project_updates";
CREATE POLICY "Authors and admins can manage updates" ON "project_updates"
FOR UPDATE
USING (
    author_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_updates"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
                    AND m.role IN ('owner', 'admin')
              )
          )
    )
)
WITH CHECK (
    author_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_updates"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
                    AND m.role IN ('owner', 'admin')
              )
          )
    )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Project update likes are viewable with updates" ON "project_update_likes";
CREATE POLICY "Project update likes are viewable with updates" ON "project_update_likes"
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "project_updates" u
        JOIN "projects" p ON p.id = u.project_id
        WHERE u.id = "project_update_likes"."update_id"
          AND u.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
              )
              OR (
                  p.visibility = 'public'
                  AND u.visibility = 'public'
                  AND (COALESCE(p.public_tab_visibility, '{}'::jsonb)->>'updates') IS DISTINCT FROM 'false'
              )
          )
    )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can manage their project update likes" ON "project_update_likes";
DROP POLICY IF EXISTS "Users can create their project update likes" ON "project_update_likes";
CREATE POLICY "Users can create their project update likes" ON "project_update_likes"
FOR INSERT
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM "project_updates" u
        JOIN "projects" p ON p.id = u.project_id
        WHERE u.id = "project_update_likes"."update_id"
          AND u.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
              )
              OR (
                  p.visibility = 'public'
                  AND u.visibility = 'public'
                  AND (COALESCE(p.public_tab_visibility, '{}'::jsonb)->>'updates') IS DISTINCT FROM 'false'
              )
          )
    )
);
-- project_updates_schema_repair_end
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can remove their project update likes" ON "project_update_likes";
CREATE POLICY "Users can remove their project update likes" ON "project_update_likes"
FOR DELETE
USING (user_id = auth.uid());
--> statement-breakpoint
DROP POLICY IF EXISTS "Project update comments are viewable with updates" ON "project_update_comments";
CREATE POLICY "Project update comments are viewable with updates" ON "project_update_comments"
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "project_updates" u
        JOIN "projects" p ON p.id = u.project_id
        WHERE u.id = "project_update_comments"."update_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
              )
              OR (
                  p.visibility = 'public'
                  AND u.visibility = 'public'
                  AND (COALESCE(p.public_tab_visibility, '{}'::jsonb)->>'updates') IS DISTINCT FROM 'false'
              )
          )
    )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can create project update comments" ON "project_update_comments";
CREATE POLICY "Users can create project update comments" ON "project_update_comments"
FOR INSERT
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM "project_updates" u
        JOIN "projects" p ON p.id = u.project_id
        WHERE u.id = "project_update_comments"."update_id"
          AND u.project_id = "project_update_comments"."project_id"
          AND u.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
              )
              OR (
                  p.visibility = 'public'
                  AND u.visibility = 'public'
                  AND u.reply_policy = 'logged_in'
                  AND (COALESCE(p.public_tab_visibility, '{}'::jsonb)->>'updates') IS DISTINCT FROM 'false'
              )
          )
    )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Authors and admins can manage project update comments" ON "project_update_comments";
CREATE POLICY "Authors and admins can manage project update comments" ON "project_update_comments"
FOR UPDATE
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_update_comments"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
                    AND m.role IN ('owner', 'admin')
              )
          )
    )
)
WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_update_comments"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" m
                  WHERE m.project_id = p.id
                    AND m.user_id = auth.uid()
                    AND m.role IN ('owner', 'admin')
              )
          )
    )
);
