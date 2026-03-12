-- ============================================================================
-- DATABASE PERFORMANCE INDEXES
-- Run this in Supabase SQL Editor for optimal query performance
-- ============================================================================

-- Profile lookups by username (used for availability checks)
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower_unique ON profiles (lower(username)) WHERE username IS NOT NULL;

-- ============================================================================
-- ONBOARDING USERNAME GUARDRAILS
-- ============================================================================

ALTER TABLE profiles
DROP CONSTRAINT IF EXISTS profiles_username_format_check;

ALTER TABLE profiles
ADD CONSTRAINT profiles_username_format_check
CHECK (
    username IS NULL
    OR username ~ '^[a-z0-9_]{3,20}$'
) NOT VALID;

CREATE TABLE IF NOT EXISTS reserved_usernames (
    username text PRIMARY KEY,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reserved_usernames (username, reason) VALUES
    ('admin', 'system'),
    ('edge', 'brand'),
    ('api', 'system'),
    ('www', 'system'),
    ('mail', 'system'),
    ('support', 'system'),
    ('help', 'system'),
    ('settings', 'system'),
    ('profile', 'system'),
    ('login', 'auth'),
    ('signup', 'auth'),
    ('auth', 'auth'),
    ('onboarding', 'system')
ON CONFLICT (username) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_profile_username_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.username IS NULL THEN
        RETURN NEW;
    END IF;

    NEW.username := lower(trim(NEW.username));

    IF NEW.username !~ '^[a-z0-9_]{3,20}$' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid username format';
    END IF;

    IF EXISTS (SELECT 1 FROM public.reserved_usernames WHERE username = NEW.username) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Username is reserved';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_username_rules_trigger ON profiles;
CREATE TRIGGER profiles_username_rules_trigger
BEFORE INSERT OR UPDATE OF username ON profiles
FOR EACH ROW
EXECUTE FUNCTION enforce_profile_username_rules();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS onboarding_drafts (
    user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    step integer NOT NULL DEFAULT 1,
    version integer NOT NULL DEFAULT 1,
    draft jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_drafts_updated_at_idx ON onboarding_drafts(updated_at);
DROP TRIGGER IF EXISTS onboarding_drafts_updated_at_trigger ON onboarding_drafts;
CREATE TRIGGER onboarding_drafts_updated_at_trigger
BEFORE UPDATE ON onboarding_drafts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE onboarding_drafts DROP CONSTRAINT IF EXISTS onboarding_drafts_step_range_check;
ALTER TABLE onboarding_drafts ADD CONSTRAINT onboarding_drafts_step_range_check
CHECK (step BETWEEN 1 AND 4) NOT VALID;

CREATE TABLE IF NOT EXISTS onboarding_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    step integer,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_events_user_idx ON onboarding_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS onboarding_events_event_idx ON onboarding_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS profile_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    previous_value jsonb DEFAULT NULL,
    next_value jsonb DEFAULT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_audit_events_user_event_idx
ON profile_audit_events(user_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS profile_audit_events_user_created_idx
ON profile_audit_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS onboarding_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'processing',
    response jsonb NOT NULL DEFAULT '{}'::jsonb,
    claims_repaired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_submissions
ADD COLUMN IF NOT EXISTS claims_repaired_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submissions_user_key_uidx
ON onboarding_submissions(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS onboarding_submissions_status_updated_idx
ON onboarding_submissions(status, updated_at);
CREATE INDEX IF NOT EXISTS onboarding_submissions_repair_queue_idx
ON onboarding_submissions(status, claims_repaired_at, updated_at);
DROP TRIGGER IF EXISTS onboarding_submissions_updated_at_trigger ON onboarding_submissions;
CREATE TRIGGER onboarding_submissions_updated_at_trigger
BEFORE UPDATE ON onboarding_submissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE onboarding_submissions DROP CONSTRAINT IF EXISTS onboarding_submissions_status_check;
ALTER TABLE onboarding_submissions ADD CONSTRAINT onboarding_submissions_status_check
CHECK (status IN ('processing', 'completed', 'failed')) NOT VALID;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_onboarding_shape_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_onboarding_shape_check
CHECK (
  (full_name IS NULL OR char_length(trim(full_name)) BETWEEN 2 AND 80)
  AND (headline IS NULL OR char_length(headline) <= 120)
  AND (bio IS NULL OR char_length(bio) <= 500)
  AND (location IS NULL OR char_length(location) <= 120)
  AND (
    website IS NULL
    OR (
      char_length(website) <= 200
      AND website ~ '^https?://'
    )
  )
  AND (
    visibility IS NULL
    OR visibility IN ('public', 'connections', 'private')
  )
  AND (
    skills IS NULL
    OR (
      jsonb_typeof(skills) = 'array'
      AND jsonb_array_length(skills) <= 25
    )
  )
  AND (
    interests IS NULL
    OR (
      jsonb_typeof(interests) = 'array'
      AND jsonb_array_length(interests) <= 25
    )
  )
) NOT VALID;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS experience_level text;
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS hours_per_week text;
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS gender_identity text;
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS pronouns text;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_experience_level_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_experience_level_check
CHECK (
  experience_level IS NULL
  OR experience_level IN ('student', 'junior', 'mid', 'senior', 'lead', 'founder')
) NOT VALID;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_hours_per_week_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_hours_per_week_check
CHECK (
  hours_per_week IS NULL
  OR hours_per_week IN ('lt_5', 'h_5_10', 'h_10_20', 'h_20_40', 'h_40_plus')
) NOT VALID;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_gender_identity_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_gender_identity_check
CHECK (
  gender_identity IS NULL
  OR gender_identity IN ('male', 'female', 'non_binary', 'prefer_not_to_say', 'other')
) NOT VALID;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pronouns_length_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_pronouns_length_check
CHECK (
  pronouns IS NULL
  OR char_length(trim(pronouns)) <= 60
) NOT VALID;

CREATE OR REPLACE VIEW onboarding_slo_daily WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    date_trunc('day', created_at) AS day,
    event_type
  FROM onboarding_events
  WHERE created_at >= now() - interval '30 days'
)
SELECT
  day::date AS day,
  count(*) FILTER (WHERE event_type = 'submit_start') AS submit_starts,
  count(*) FILTER (WHERE event_type = 'submit_success') AS submit_successes,
  count(*) FILTER (WHERE event_type = 'submit_error') AS submit_errors,
  CASE
    WHEN count(*) FILTER (WHERE event_type = 'submit_start') = 0 THEN NULL::numeric
    ELSE (
      count(*) FILTER (WHERE event_type = 'submit_success')::numeric
      / count(*) FILTER (WHERE event_type = 'submit_start')::numeric
    )
  END AS submit_success_rate
FROM base
GROUP BY day
ORDER BY day DESC;

CREATE OR REPLACE VIEW onboarding_funnel_dimensions_daily WITH (security_invoker = true) AS
SELECT
  date_trunc('day', created_at)::date AS day,
  event_type,
  COALESCE(step, 0) AS step,
  metadata->>'availabilityStatus' AS availability_status,
  metadata->>'messagePrivacy' AS message_privacy,
  metadata->>'visibility' AS visibility,
  COUNT(*) AS event_count
FROM onboarding_events
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY day DESC, event_type, step;

-- Connection queries (user's connections)
CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_addressee ON connections(addressee_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);

-- Post queries (feed, user posts)
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_project ON posts(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);

-- Project queries
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_github_repo_branch
ON projects(github_repo_url, github_default_branch)
WHERE github_repo_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_github_repo_branch_active
ON projects(github_repo_url, github_default_branch, sync_status, updated_at DESC)
WHERE github_repo_url IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_sync_status_updated_active
ON projects(sync_status, updated_at DESC)
WHERE deleted_at IS NULL;

-- Project member queries
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);

-- ============================================================================
-- STORAGE BUCKET FOR AVATARS
-- ============================================================================

-- Create avatars bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    true,
    1048576, -- 1MB limit (images are compressed before upload)
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 1048576;

-- Storage policies for avatars bucket
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

-- Public read access
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Users can upload their own avatar (filename must start with their user ID)
CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = split_part(name, '-', 1)
);

-- Users can update their own avatar
CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = split_part(name, '-', 1)
);

-- Users can delete their own avatar
CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = split_part(name, '-', 1)
);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Profiles RLS (ensure INSERT policy exists)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserved_usernames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
CREATE POLICY "Profiles are viewable by everyone"
ON profiles FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Reserved usernames are publicly readable" ON reserved_usernames;
CREATE POLICY "Reserved usernames are publicly readable"
ON reserved_usernames FOR SELECT
USING (true);

-- Onboarding tables RLS
ALTER TABLE onboarding_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can manage own onboarding drafts" ON onboarding_drafts;
CREATE POLICY "Users can manage own onboarding drafts"
ON onboarding_drafts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own onboarding submissions" ON onboarding_submissions;
CREATE POLICY "Users can view own onboarding submissions"
ON onboarding_submissions FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own onboarding submissions" ON onboarding_submissions;
CREATE POLICY "Users can create own onboarding submissions"
ON onboarding_submissions FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own onboarding submissions" ON onboarding_submissions;
CREATE POLICY "Users can update own onboarding submissions"
ON onboarding_submissions FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own onboarding events" ON onboarding_events;
CREATE POLICY "Users can view own onboarding events"
ON onboarding_events FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own profile audit events" ON profile_audit_events;
CREATE POLICY "Users can view own profile audit events"
ON profile_audit_events FOR SELECT
USING (auth.uid() = user_id);

-- Connections RLS
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own connections" ON connections;
CREATE POLICY "Users can view own connections"
ON connections FOR SELECT
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "Users can create connection requests" ON connections;
CREATE POLICY "Users can create connection requests"
ON connections FOR INSERT
WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Users can update own connections" ON connections;
CREATE POLICY "Users can update own connections"
ON connections FOR UPDATE
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Posts RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public posts are viewable by everyone" ON posts;
CREATE POLICY "Public posts are viewable by everyone"
ON posts FOR SELECT
USING (visibility = 'public' OR author_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own posts" ON posts;
CREATE POLICY "Users can create own posts"
ON posts FOR INSERT
WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Users can update own posts" ON posts;
CREATE POLICY "Users can update own posts"
ON posts FOR UPDATE
USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Users can delete own posts" ON posts;
CREATE POLICY "Users can delete own posts"
ON posts FOR DELETE
USING (auth.uid() = author_id);

-- Projects RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public projects are viewable by everyone" ON projects;
CREATE POLICY "Public projects are viewable by everyone"
ON projects FOR SELECT
USING (visibility = 'public' OR owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own projects" ON projects;
CREATE POLICY "Users can create own projects"
ON projects FOR INSERT
WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update own projects" ON projects;
CREATE POLICY "Users can update own projects"
ON projects FOR UPDATE
USING (auth.uid() = owner_id);

-- Project Members RLS
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members are viewable" ON project_members;
CREATE POLICY "Project members are viewable"
ON project_members FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Project owners can manage members" ON project_members;
CREATE POLICY "Project owners can manage members"
ON project_members FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = project_members.project_id
        AND projects.owner_id = auth.uid()
    )
);

-- ============================================================================
-- FILES WORKSPACE INDEXES + RLS + STORAGE PARITY
-- ============================================================================
CREATE INDEX IF NOT EXISTS project_nodes_active_name_lookup_idx
ON project_nodes(project_id, parent_id, lower(name))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS project_node_locks_project_node_expires_idx
ON project_node_locks(project_id, node_id, expires_at);

CREATE INDEX IF NOT EXISTS project_nodes_project_deleted_updated_idx
ON project_nodes(project_id, deleted_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_nodes_active_file_reconcile
ON project_nodes(project_id, type, s3_key)
WHERE deleted_at IS NULL AND type = 'file';

ALTER TABLE project_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_file_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_node_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_node_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_nodes_read ON project_nodes;
CREATE POLICY project_nodes_read ON project_nodes
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_nodes_public_read ON project_nodes;
CREATE POLICY project_nodes_public_read ON project_nodes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_id
      AND p.visibility = 'public'
  )
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS project_nodes_write ON project_nodes;
CREATE POLICY project_nodes_write ON project_nodes
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

DROP POLICY IF EXISTS project_file_index_read ON project_file_index;
CREATE POLICY project_file_index_read ON project_file_index
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_file_index_public_read ON project_file_index;
CREATE POLICY project_file_index_public_read ON project_file_index
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_id
      AND p.visibility = 'public'
  )
);

DROP POLICY IF EXISTS project_file_index_write ON project_file_index;
CREATE POLICY project_file_index_write ON project_file_index
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

DROP POLICY IF EXISTS project_node_locks_read ON project_node_locks;
CREATE POLICY project_node_locks_read ON project_node_locks
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_node_locks_write ON project_node_locks;
CREATE POLICY project_node_locks_write ON project_node_locks
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

DROP POLICY IF EXISTS project_node_events_read ON project_node_events;
CREATE POLICY project_node_events_read ON project_node_events
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS project_node_events_write ON project_node_events;
CREATE POLICY project_node_events_write ON project_node_events
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM project_members m
    WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer'
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-files', 'project-files', false, 10485760)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760;

DROP POLICY IF EXISTS project_files_read ON storage.objects;
CREATE POLICY project_files_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-files'
  AND (
    (
      split_part(name, '/', 1) = 'projects'
      AND split_part(name, '/', 2) <> ''
      AND split_part(name, '/', 3) <> ''
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id::text = split_part(name, '/', 2)
          AND p.owner_id = auth.uid()
      )
    )
    OR (
      split_part(name, '/', 1) <> 'projects'
      AND split_part(name, '/', 1) <> ''
      AND split_part(name, '/', 2) <> ''
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id::text = split_part(name, '/', 1)
          AND p.owner_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.user_id = auth.uid()
        AND (
          (
            split_part(name, '/', 1) = 'projects'
            AND m.project_id::text = split_part(name, '/', 2)
          )
          OR (
            split_part(name, '/', 1) <> 'projects'
            AND m.project_id::text = split_part(name, '/', 1)
          )
        )
    )
  )
);

DROP POLICY IF EXISTS project_files_public_read ON storage.objects;
CREATE POLICY project_files_public_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-files'
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.visibility = 'public'
      AND (
        (
          split_part(name, '/', 1) = 'projects'
          AND split_part(name, '/', 2) <> ''
          AND split_part(name, '/', 3) <> ''
          AND p.id::text = split_part(name, '/', 2)
        )
        OR (
          split_part(name, '/', 1) <> 'projects'
          AND split_part(name, '/', 1) <> ''
          AND split_part(name, '/', 2) <> ''
          AND p.id::text = split_part(name, '/', 1)
        )
      )
  )
);

DROP POLICY IF EXISTS project_files_write ON storage.objects;
CREATE POLICY project_files_write ON storage.objects
FOR ALL
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) <> 'projects'
  AND split_part(name, '/', 1) <> ''
  AND split_part(name, '/', 2) <> ''
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 1) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 1) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) <> 'projects'
  AND split_part(name, '/', 1) <> ''
  AND split_part(name, '/', 2) <> ''
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 1) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 1) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
);

-- ============================================================================
-- PERFORMANCE: Analyze tables after index creation
-- ============================================================================
ANALYZE profiles;
ANALYZE connections;
ANALYZE posts;
ANALYZE projects;
ANALYZE project_members;
ANALYZE project_nodes;
ANALYZE project_file_index;
ANALYZE project_node_locks;
ANALYZE project_node_events;
ANALYZE onboarding_drafts;
ANALYZE onboarding_submissions;
ANALYZE onboarding_events;
ANALYZE profile_audit_events;
-- ============================================================================
-- PURE OPTIMIZATION RLS POLICIES FOR MISSING TABLES
-- ============================================================================

-- 1. CONVERSATIONS & PARTICIPANTS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_pairs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view conversations they are part of" ON conversations;
CREATE POLICY "Users can view conversations they are part of" ON conversations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants cp 
    WHERE cp.conversation_id = id AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
CREATE POLICY "Users can view participants of their conversations" ON conversation_participants
FOR SELECT
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM conversation_participants my_cp 
    WHERE my_cp.conversation_id = conversation_id AND my_cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can manage their own participant state" ON conversation_participants;
CREATE POLICY "Users can manage their own participant state" ON conversation_participants
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view DM pairs they are part of" ON dm_pairs;
CREATE POLICY "Users can view DM pairs they are part of" ON dm_pairs
FOR SELECT
USING (user_low = auth.uid() OR user_high = auth.uid());

-- 2. MESSAGES & ATTACHMENTS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_edit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_hidden_for_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations" ON messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants cp 
    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can insert their own messages" ON messages;
CREATE POLICY "Users can insert their own messages" ON messages
FOR INSERT
WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own messages" ON messages;
CREATE POLICY "Users can update their own messages" ON messages
FOR UPDATE
USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON message_attachments;
CREATE POLICY "Users can view attachments in their conversations" ON message_attachments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
    WHERE m.id = message_id AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can view message edit logs in their conversations" ON message_edit_logs;
CREATE POLICY "Users can view message edit logs in their conversations" ON message_edit_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
    WHERE m.id = message_id AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can manage their own message hidden state" ON message_hidden_for_users;
CREATE POLICY "Users can manage their own message hidden state" ON message_hidden_for_users
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own uploads" ON attachment_uploads;
CREATE POLICY "Users can manage their own uploads" ON attachment_uploads
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 3. TASKS, SUBTASKS & LINKS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_node_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tasks are viewable by project members or if public" ON tasks;
CREATE POLICY "Tasks are viewable by project members or if public" ON tasks
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.visibility = 'public'))
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Task writers can manage tasks" ON tasks;
CREATE POLICY "Task writers can manage tasks" ON tasks
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
);

DROP POLICY IF EXISTS "Subtasks are viewable like tasks" ON task_subtasks;
CREATE POLICY "Subtasks are viewable like tasks" ON task_subtasks
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_id AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND (p.owner_id = auth.uid() OR p.visibility = 'public'))
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Task writers can manage subtasks" ON task_subtasks;
CREATE POLICY "Task writers can manage subtasks" ON task_subtasks
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_id AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_id AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
    )
  )
);

DROP POLICY IF EXISTS "Task links are viewable like tasks" ON task_node_links;
CREATE POLICY "Task links are viewable like tasks" ON task_node_links
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_id AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND (p.owner_id = auth.uid() OR p.visibility = 'public'))
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Task writers can manage task links" ON task_node_links;
CREATE POLICY "Task writers can manage task links" ON task_node_links
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_id AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_id AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
    )
  )
);

-- 4. PROJECT SPRINTS, FOLLOWS, SAVES, PROFILES
ALTER TABLE project_sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_run_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sprints are viewable like projects" ON project_sprints;
CREATE POLICY "Sprints are viewable like projects" ON project_sprints
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.visibility = 'public'))
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project writers can manage sprints" ON project_sprints;
CREATE POLICY "Project writers can manage sprints" ON project_sprints
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
);

DROP POLICY IF EXISTS "Follows are public" ON project_follows;
CREATE POLICY "Follows are public" ON project_follows
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can manage their own follows" ON project_follows;
CREATE POLICY "Users can manage their own follows" ON project_follows
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own saves" ON saved_projects;
CREATE POLICY "Users can manage their own saves" ON saved_projects
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Run profiles are viewable by members" ON project_run_profiles;
CREATE POLICY "Run profiles are viewable by members" ON project_run_profiles
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project writers can manage run profiles" ON project_run_profiles;
CREATE POLICY "Project writers can manage run profiles" ON project_run_profiles
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role <> 'viewer')
);

-- 5. PROJECT LOGS (SECURE SESSION IDS - OWNER ONLY AS REQUESTED)
ALTER TABLE project_run_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_run_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project owners can manage sessions" ON project_run_sessions;
CREATE POLICY "Project owners can manage sessions" ON project_run_sessions
FOR ALL
USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Project owners can manage logs" ON project_run_logs;
CREATE POLICY "Project owners can manage logs" ON project_run_logs
FOR ALL
USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Project owners can manage diagnostics" ON project_run_diagnostics;
CREATE POLICY "Project owners can manage diagnostics" ON project_run_diagnostics
FOR ALL
USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

-- 6. ROLES & APPLICATIONS
ALTER TABLE project_open_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Open roles are viewable like projects" ON project_open_roles;
CREATE POLICY "Open roles are viewable like projects" ON project_open_roles
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.visibility = 'public'))
  OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project owners can manage open roles" ON project_open_roles;
CREATE POLICY "Project owners can manage open roles" ON project_open_roles
FOR ALL
USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view their own applications or project owner can view all" ON role_applications;
CREATE POLICY "Users can view their own applications or project owner can view all" ON role_applications
FOR SELECT
USING (
  applicant_id = auth.uid() OR
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can apply" ON role_applications;
CREATE POLICY "Users can apply" ON role_applications
FOR INSERT
WITH CHECK (applicant_id = auth.uid());

DROP POLICY IF EXISTS "Project owners can update applications" ON role_applications;
-- Canonical UPDATE policy for applications is defined later in this script as:
-- "Users can update their own applications or project admins can manage"
-- Keep this legacy policy dropped to avoid conflicting effective behavior.

-- 7. MISCELLANEOUS 
ALTER TABLE connection_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their dismissals" ON connection_suggestion_dismissals;
CREATE POLICY "Users can manage their dismissals" ON connection_suggestion_dismissals
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
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
CREATE INDEX IF NOT EXISTS idx_onboarding_drafts_user_id ON public.onboarding_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id ON public.messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id ON public.messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender_client_lookup ON public.messages(conversation_id, sender_id, client_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_hidden_for_users_message_id ON public.message_hidden_for_users(message_id);
CREATE INDEX IF NOT EXISTS idx_message_hidden_for_users_user_id ON public.message_hidden_for_users(user_id);
CREATE INDEX IF NOT EXISTS idx_message_hidden_for_users_user_message ON public.message_hidden_for_users(user_id, message_id);
CREATE INDEX IF NOT EXISTS idx_message_edit_logs_message_id ON public.message_edit_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_message_edit_logs_editor_id ON public.message_edit_logs(editor_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON public.message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON public.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_read_watermark ON public.conversation_participants(conversation_id, user_id, last_read_message_id);
CREATE INDEX IF NOT EXISTS idx_connections_requester_id ON public.connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_addressee_id ON public.connections(addressee_id);
CREATE INDEX IF NOT EXISTS idx_connection_suggestion_dismissals_user_id ON public.connection_suggestion_dismissals(user_id);
CREATE INDEX IF NOT EXISTS idx_connection_suggestion_dismissals_dismissed_profile_id ON public.connection_suggestion_dismissals(dismissed_profile_id);
CREATE INDEX IF NOT EXISTS idx_attachment_uploads_user_id ON public.attachment_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_attachment_uploads_conversation_id ON public.attachment_uploads(conversation_id);

-- ============================================================================
-- PURE OPTIMIZATION RLS POLICIES FOR SECURITY ADVISOR FLAGGED TABLES
-- ============================================================================

-- 4. ROLE APPLICATIONS & SAVED PROJECTS & OPEN ROLES & SPRINTS & DISMISSALS & COLLECTIONS & FOLLOWS
ALTER TABLE role_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_open_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_sprints ENABLE ROW LEVEL SECURITY;

-- Role Applications
DROP POLICY IF EXISTS "Users can view applications for their projects or their own" ON role_applications;
CREATE POLICY "Users can view applications for their projects or their own" ON role_applications
FOR SELECT
USING (
  applicant_id = auth.uid() OR
  EXISTS (SELECT 1 FROM projects p WHERE p.id = role_applications.project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = role_applications.project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin'))
);

DROP POLICY IF EXISTS "Users can create their own applications" ON role_applications;
CREATE POLICY "Users can create their own applications" ON role_applications
FOR INSERT
WITH CHECK (applicant_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own applications or project admins can manage" ON role_applications;
DROP POLICY IF EXISTS "Project owners can update applications" ON role_applications;
CREATE POLICY "Users can update their own applications or project admins can manage" ON role_applications
FOR UPDATE
USING (
  applicant_id = auth.uid() OR
  EXISTS (SELECT 1 FROM projects p WHERE p.id = role_applications.project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = role_applications.project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin'))
)
WITH CHECK (
  applicant_id = auth.uid() OR
  EXISTS (SELECT 1 FROM projects p WHERE p.id = role_applications.project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = role_applications.project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin'))
);

-- Saved Projects
DROP POLICY IF EXISTS "Users can manage their saved projects" ON saved_projects;
CREATE POLICY "Users can manage their saved projects" ON saved_projects
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Connection Suggestion Dismissals
DROP POLICY IF EXISTS "Users can manage their connection dismissals" ON connection_suggestion_dismissals;
CREATE POLICY "Users can manage their connection dismissals" ON connection_suggestion_dismissals
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Collections
DROP POLICY IF EXISTS "Users can view public collections or their own" ON collections;
CREATE POLICY "Users can view public collections or their own" ON collections
FOR SELECT
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own collections" ON collections;
CREATE POLICY "Users can manage their own collections" ON collections
FOR ALL
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Collection Projects
DROP POLICY IF EXISTS "Users can view projects in public collections or their own" ON collection_projects;
CREATE POLICY "Users can view projects in public collections or their own" ON collection_projects
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can manage projects in their collections" ON collection_projects;
CREATE POLICY "Users can manage projects in their collections" ON collection_projects
FOR ALL
USING (EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.owner_id = auth.uid()));

-- Project Follows
DROP POLICY IF EXISTS "Users can manage their project follows" ON project_follows;
CREATE POLICY "Users can manage their project follows" ON project_follows
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Project Open Roles
DROP POLICY IF EXISTS "Open roles are viewable by everyone" ON project_open_roles;
CREATE POLICY "Open roles are viewable by everyone" ON project_open_roles
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.id = project_id
      AND (
        p.visibility = 'public'
        OR p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM project_members m
          WHERE m.project_id = p.id
            AND m.user_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Project admins can manage open roles" ON project_open_roles;
CREATE POLICY "Project admins can manage open roles" ON project_open_roles
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin'))
);

-- Project Sprints
DROP POLICY IF EXISTS "Sprints are viewable by project members or if public" ON project_sprints;
CREATE POLICY "Sprints are viewable by project members or if public" ON project_sprints
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.visibility = 'public')) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project admins can manage sprints" ON project_sprints;
CREATE POLICY "Project admins can manage sprints" ON project_sprints
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member'))
);


-- 5. TASK COMMENTS & LIKES
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments are viewable by users who can see the task" ON task_comments;
CREATE POLICY "Comments are viewable by users who can see the task" ON task_comments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.id = task_id AND (p.owner_id = auth.uid() OR p.visibility = 'public' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = auth.uid()))
  )
);

DROP POLICY IF EXISTS "Users can manage their own comments" ON task_comments;
CREATE POLICY "Users can manage their own comments" ON task_comments
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Likes are viewable by users who can see the comment task" ON task_comment_likes;
CREATE POLICY "Likes are viewable by users who can see the comment task" ON task_comment_likes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM task_comments tc JOIN tasks t ON tc.task_id = t.id JOIN projects p ON t.project_id = p.id
    WHERE tc.id = comment_id AND (p.owner_id = auth.uid() OR p.visibility = 'public' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = auth.uid()))
  )
);

DROP POLICY IF EXISTS "Users can manage their own likes" ON task_comment_likes;
CREATE POLICY "Users can manage their own likes" ON task_comment_likes
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());


-- 6. RUNNER LOGS & SESSIONS & PROFILES (SENSITIVE COLUMNS)
ALTER TABLE project_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_run_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_run_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_run_sessions ENABLE ROW LEVEL SECURITY;

-- We want to strictly lock down run diagnostic and log tables containing `session_id`
-- Only users who are members of that project should be allowed to interact.

DROP POLICY IF EXISTS "Project runners can view sessions" ON project_run_sessions;
CREATE POLICY "Project runners can view sessions" ON project_run_sessions
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project runners can manage sessions" ON project_run_sessions;
CREATE POLICY "Project runners can manage sessions" ON project_run_sessions
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project runners can view run profiles" ON project_run_profiles;
CREATE POLICY "Project runners can view run profiles" ON project_run_profiles
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project runners can manage run profiles" ON project_run_profiles;
CREATE POLICY "Project runners can manage run profiles" ON project_run_profiles
FOR ALL
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

-- STRICT RLS ON SENSITIVE TABLES (project_run_diagnostics, project_run_logs)
DROP POLICY IF EXISTS "Project runners can view run diagnostics" ON project_run_diagnostics;
CREATE POLICY "Project runners can view run diagnostics" ON project_run_diagnostics
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project runners can insert run diagnostics" ON project_run_diagnostics;
CREATE POLICY "Project runners can insert run diagnostics" ON project_run_diagnostics
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project runners can view run logs" ON project_run_logs;
CREATE POLICY "Project runners can view run logs" ON project_run_logs
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Project runners can insert run logs" ON project_run_logs;
CREATE POLICY "Project runners can insert run logs" ON project_run_logs
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
);


CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interests_name_unique" UNIQUE("name"),
	CONSTRAINT "interests_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profile_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name"),
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "project_node_events" DROP CONSTRAINT "project_node_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_nodes" DROP CONSTRAINT "project_nodes_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_logs" DROP CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_logs" DROP CONSTRAINT "project_run_logs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_profiles" DROP CONSTRAINT "project_run_profiles_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_sessions" DROP CONSTRAINT "project_run_sessions_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD COLUMN "path" text DEFAULT '/' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interests_name_search_idx" ON "interests" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "profile_interests_unique_idx" ON "profile_interests" USING btree ("profile_id","interest_id");--> statement-breakpoint
CREATE INDEX "profile_interests_interest_idx" ON "profile_interests" USING btree ("interest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_skills_unique_idx" ON "profile_skills" USING btree ("profile_id","skill_id");--> statement-breakpoint
CREATE INDEX "profile_skills_skill_idx" ON "profile_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_skills_unique_idx" ON "project_skills" USING btree ("project_id","skill_id");--> statement-breakpoint
CREATE INDEX "project_skills_skill_idx" ON "project_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_tags_unique_idx" ON "project_tags" USING btree ("project_id","tag_id");--> statement-breakpoint
CREATE INDEX "project_tags_tag_idx" ON "project_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "skills_name_search_idx" ON "skills" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_search_idx" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "project_node_events" ADD CONSTRAINT "project_node_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_run_sessions_id_project_id_key'
      AND conrelid = 'project_run_sessions'::regclass
  ) THEN
    ALTER TABLE "project_run_sessions"
      ADD CONSTRAINT "project_run_sessions_id_project_id_key" UNIQUE ("id", "project_id");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id","project_id") REFERENCES "public"."project_run_sessions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_logs" ADD CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id","project_id") REFERENCES "public"."project_run_sessions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_logs" ADD CONSTRAINT "project_run_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_profiles" ADD CONSTRAINT "project_run_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_sessions" ADD CONSTRAINT "project_run_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_nodes_path_idx" ON "project_nodes" USING btree ("path");-- scripts/setup-partitioning.sql

-- Partition bootstrap is managed in scripts/setup-partitioning.sql.
-- Keep this setup script non-destructive for existing data and RLS policy safety.
