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

    IF EXISTS (SELECT 1 FROM reserved_usernames WHERE username = NEW.username) THEN
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
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS project_files_public_read ON storage.objects;
CREATE POLICY project_files_public_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id::text = split_part(name, '/', 2)
      AND p.visibility = 'public'
  )
);

DROP POLICY IF EXISTS project_files_write ON storage.objects;
CREATE POLICY project_files_write ON storage.objects
FOR ALL
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) = 'projects'
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid() AND m.role <> 'viewer'
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
CREATE POLICY "Project owners can update applications" ON role_applications
FOR UPDATE
USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

-- 7. MISCELLANEOUS 
ALTER TABLE connection_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their dismissals" ON connection_suggestion_dismissals;
CREATE POLICY "Users can manage their dismissals" ON connection_suggestion_dismissals
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
