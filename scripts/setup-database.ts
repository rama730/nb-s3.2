/**
 * Database Setup Script
 * Run with: npx tsx scripts/setup-database.ts
 */

import postgres from 'postgres'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env.local')
    process.exit(1)
}

const sql = postgres(DATABASE_URL, {
    prepare: false,
    ssl: 'require'
})

async function setupDatabase() {
    console.log('🚀 Starting database setup...\n')

    try {
        const [tableFlags] = await sql<{ postsExists: boolean }[]>`
            SELECT to_regclass('public.posts') IS NOT NULL AS "postsExists"
        `;
        const postsExists = tableFlags?.postsExists === true;
        const expectedIndexNames = [
            'idx_profiles_username',
            'idx_profiles_username_lower_unique',
            'idx_connections_requester',
            'idx_connections_addressee',
            'idx_connections_status',
            'idx_projects_owner',
            'idx_projects_status',
            'idx_project_members_user',
            'idx_project_members_project',
            'onboarding_drafts_updated_at_idx',
            'onboarding_events_user_idx',
            'onboarding_events_event_idx',
            'profile_audit_events_user_event_idx',
            'profile_audit_events_user_created_idx',
            'onboarding_submissions_user_key_uidx',
            'onboarding_submissions_status_updated_idx',
            'onboarding_submissions_repair_queue_idx',
            'project_nodes_active_name_lookup_idx',
            'project_node_locks_project_node_expires_idx',
            'project_nodes_project_deleted_updated_idx',
        ]
        if (postsExists) {
            expectedIndexNames.push(
                'idx_posts_author',
                'idx_posts_created_at',
                'idx_posts_visibility'
            )
        }
        const expectedRlsTables = [
            'profiles',
            'connections',
            'projects',
            'project_members',
            'project_nodes',
            'project_file_index',
            'project_node_locks',
            'project_node_events',
            'onboarding_drafts',
            'onboarding_submissions',
            'onboarding_events',
            'profile_audit_events',
        ]
        if (postsExists) expectedRlsTables.push('posts')
        const expectedPolicyNames = [
            'Users can view all profiles',
            'Users can insert own profile',
            'Users can update own profile',
            'Users can view own connections',
            'Users can create connection requests',
            'Users can update own connections',
            'Public projects are viewable by everyone',
            'Users can create own projects',
            'Users can update own projects',
            'Project members are viewable',
            'project_nodes_read',
            'project_nodes_public_read',
            'project_nodes_write',
            'project_file_index_read',
            'project_file_index_public_read',
            'project_file_index_write',
            'project_node_locks_read',
            'project_node_locks_write',
            'project_node_events_read',
            'project_node_events_write',
            'Users can manage own onboarding drafts',
            'Users can view own onboarding submissions',
            'Users can create own onboarding submissions',
            'Users can update own onboarding submissions',
            'Users can view own onboarding events',
            'Users can view own profile audit events',
            'project_files_read',
            'project_files_public_read',
            'project_files_write',
        ]
        if (postsExists) {
            expectedPolicyNames.push(
                'Public posts are viewable by everyone',
                'Users can create own posts',
                'Users can update own posts',
                'Users can delete own posts'
            )
        }
        const indexesConfiguredCount = expectedIndexNames.length
        const rlsEnabledTablesCount = expectedRlsTables.length
        const securityPoliciesConfiguredCount = expectedPolicyNames.length

        // ============================================
        // 1. Create Indexes for Performance
        // ============================================
        console.log('📊 Creating performance indexes...')

        await sql`CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username)`
        console.log('  ✅ idx_profiles_username')
        await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower_unique ON profiles(lower(username)) WHERE username IS NOT NULL`
        console.log('  ✅ idx_profiles_username_lower_unique')

        await sql`CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id)`
        console.log('  ✅ idx_connections_requester')

        await sql`CREATE INDEX IF NOT EXISTS idx_connections_addressee ON connections(addressee_id)`
        console.log('  ✅ idx_connections_addressee')

        await sql`CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status)`
        console.log('  ✅ idx_connections_status')

        if (postsExists) {
            await sql`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id)`
            console.log('  ✅ idx_posts_author')

            await sql`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`
            console.log('  ✅ idx_posts_created_at')

            await sql`CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility)`
            console.log('  ✅ idx_posts_visibility')
        } else {
            console.log('  ℹ️ Skipping posts indexes (table not present)')
        }

        await sql`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`
        console.log('  ✅ idx_projects_owner')

        await sql`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`
        console.log('  ✅ idx_projects_status')

        await sql`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`
        console.log('  ✅ idx_project_members_user')

        await sql`CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)`
        console.log('  ✅ idx_project_members_project')

        await sql`CREATE INDEX IF NOT EXISTS project_nodes_active_name_lookup_idx ON project_nodes(project_id, parent_id, lower(name)) WHERE deleted_at IS NULL`
        console.log('  ✅ project_nodes_active_name_lookup_idx')

        await sql`CREATE INDEX IF NOT EXISTS project_node_locks_project_node_expires_idx ON project_node_locks(project_id, node_id, expires_at)`
        console.log('  ✅ project_node_locks_project_node_expires_idx')

        await sql`CREATE INDEX IF NOT EXISTS project_nodes_project_deleted_updated_idx ON project_nodes(project_id, deleted_at, updated_at DESC)`
        console.log('  ✅ project_nodes_project_deleted_updated_idx')

        await sql`ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_format_check`
        await sql`ALTER TABLE profiles ADD CONSTRAINT profiles_username_format_check CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$') NOT VALID`
        console.log('  ✅ profiles_username_format_check')

        await sql`CREATE TABLE IF NOT EXISTS reserved_usernames (
            username text PRIMARY KEY,
            reason text,
            created_at timestamptz NOT NULL DEFAULT now()
        )`
        await sql`INSERT INTO reserved_usernames (username, reason) VALUES
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
            ON CONFLICT (username) DO NOTHING`
        console.log('  ✅ reserved_usernames seed')

        await sql.unsafe(`
            CREATE OR REPLACE FUNCTION enforce_profile_username_rules()
            RETURNS trigger
            LANGUAGE plpgsql
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
        `)
        await sql`DROP TRIGGER IF EXISTS profiles_username_rules_trigger ON profiles`
        await sql`CREATE TRIGGER profiles_username_rules_trigger
            BEFORE INSERT OR UPDATE OF username ON profiles
            FOR EACH ROW
            EXECUTE FUNCTION enforce_profile_username_rules()`
        console.log('  ✅ username trigger')

        await sql`CREATE TABLE IF NOT EXISTS onboarding_drafts (
            user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
            step integer NOT NULL DEFAULT 1,
            version integer NOT NULL DEFAULT 1,
            draft jsonb NOT NULL DEFAULT '{}'::jsonb,
            updated_at timestamptz NOT NULL DEFAULT now()
        )`
        await sql`ALTER TABLE onboarding_drafts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`
        await sql`CREATE INDEX IF NOT EXISTS onboarding_drafts_updated_at_idx ON onboarding_drafts(updated_at)`
        console.log('  ✅ onboarding_drafts')

        await sql`CREATE TABLE IF NOT EXISTS onboarding_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
            event_type text NOT NULL,
            step integer,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )`
        await sql`CREATE INDEX IF NOT EXISTS onboarding_events_user_idx ON onboarding_events(user_id, created_at)`
        await sql`CREATE INDEX IF NOT EXISTS onboarding_events_event_idx ON onboarding_events(event_type, created_at)`
        console.log('  ✅ onboarding_events')

        await sql`CREATE TABLE IF NOT EXISTS profile_audit_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
            event_type text NOT NULL,
            previous_value jsonb DEFAULT NULL,
            next_value jsonb DEFAULT NULL,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )`
        await sql`CREATE INDEX IF NOT EXISTS profile_audit_events_user_event_idx ON profile_audit_events(user_id, event_type, created_at)`
        await sql`CREATE INDEX IF NOT EXISTS profile_audit_events_user_created_idx ON profile_audit_events(user_id, created_at)`
        console.log('  ✅ profile_audit_events')

        await sql`CREATE TABLE IF NOT EXISTS onboarding_submissions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            idempotency_key text NOT NULL,
            status text NOT NULL DEFAULT 'processing',
            response jsonb NOT NULL DEFAULT '{}'::jsonb,
            claims_repaired_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )`
        await sql`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS claims_repaired_at timestamptz`
        await sql`CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submissions_user_key_uidx ON onboarding_submissions(user_id, idempotency_key)`
        await sql`CREATE INDEX IF NOT EXISTS onboarding_submissions_status_updated_idx ON onboarding_submissions(status, updated_at)`
        await sql`CREATE INDEX IF NOT EXISTS onboarding_submissions_repair_queue_idx ON onboarding_submissions(status, claims_repaired_at, updated_at)`
        console.log('  ✅ onboarding_submissions')

        await sql.unsafe(`
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
            ORDER BY day DESC
        `)
        await sql.unsafe(`
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
            ORDER BY day DESC, event_type, step
        `)
        console.log('  ✅ onboarding analytics views')

        await sql`ALTER TABLE profiles VALIDATE CONSTRAINT profiles_username_format_check`
        console.log('  ✅ profiles_username_format_check validated')

        // ============================================
        // 2. Enable RLS on all tables
        // ============================================
        console.log('\n🔒 Enabling Row Level Security...')

        await sql`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE connections ENABLE ROW LEVEL SECURITY`
        if (postsExists) {
            await sql`ALTER TABLE posts ENABLE ROW LEVEL SECURITY`
        }
        await sql`ALTER TABLE projects ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE project_members ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE project_nodes ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE project_file_index ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE project_node_locks ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE project_node_events ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE onboarding_drafts ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE onboarding_submissions ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE onboarding_events ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE profile_audit_events ENABLE ROW LEVEL SECURITY`
        console.log('  ✅ RLS enabled on all tables')

        // ============================================
        // 3. Profiles RLS Policies
        // ============================================
        console.log('\n📋 Creating profiles policies...')

        await sql`DROP POLICY IF EXISTS "Users can view all profiles" ON profiles`
        await sql`CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT USING (true)`
        console.log('  ✅ Public read policy')

        await sql`DROP POLICY IF EXISTS "Users can insert own profile" ON profiles`
        await sql`CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id)`
        console.log('  ✅ Self insert policy')

        await sql`DROP POLICY IF EXISTS "Users can update own profile" ON profiles`
        await sql`CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id)`
        console.log('  ✅ Self update policy')

        // ============================================
        // 4. Connections RLS Policies
        // ============================================
        console.log('\n📋 Creating connections policies...')

        await sql`DROP POLICY IF EXISTS "Users can view own connections" ON connections`
        await sql`CREATE POLICY "Users can view own connections" ON connections FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = addressee_id)`
        console.log('  ✅ View own connections')

        await sql`DROP POLICY IF EXISTS "Users can create connection requests" ON connections`
        await sql`CREATE POLICY "Users can create connection requests" ON connections FOR INSERT WITH CHECK (auth.uid() = requester_id)`
        console.log('  ✅ Create connection requests')

        await sql`DROP POLICY IF EXISTS "Users can update own connections" ON connections`
        await sql`CREATE POLICY "Users can update own connections" ON connections FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = addressee_id)`
        console.log('  ✅ Update own connections')

        // ============================================
        // 5. Posts RLS Policies
        // ============================================
        if (postsExists) {
            console.log('\n📋 Creating posts policies...')

            await sql`DROP POLICY IF EXISTS "Public posts are viewable by everyone" ON posts`
            await sql`CREATE POLICY "Public posts are viewable by everyone" ON posts FOR SELECT USING (visibility = 'public' OR author_id = auth.uid())`
            console.log('  ✅ Public posts viewable')

            await sql`DROP POLICY IF EXISTS "Users can create own posts" ON posts`
            await sql`CREATE POLICY "Users can create own posts" ON posts FOR INSERT WITH CHECK (auth.uid() = author_id)`
            console.log('  ✅ Create own posts')

            await sql`DROP POLICY IF EXISTS "Users can update own posts" ON posts`
            await sql`CREATE POLICY "Users can update own posts" ON posts FOR UPDATE USING (auth.uid() = author_id)`
            console.log('  ✅ Update own posts')

            await sql`DROP POLICY IF EXISTS "Users can delete own posts" ON posts`
            await sql`CREATE POLICY "Users can delete own posts" ON posts FOR DELETE USING (auth.uid() = author_id)`
            console.log('  ✅ Delete own posts')
        } else {
            console.log('\nℹ️ Skipping posts policies (table not present)')
        }

        // ============================================
        // 6. Projects RLS Policies
        // ============================================
        console.log('\n📋 Creating projects policies...')

        await sql`DROP POLICY IF EXISTS "Public projects are viewable by everyone" ON projects`
        await sql`CREATE POLICY "Public projects are viewable by everyone" ON projects FOR SELECT USING (visibility = 'public' OR owner_id = auth.uid())`
        console.log('  ✅ Public projects viewable')

        await sql`DROP POLICY IF EXISTS "Users can create own projects" ON projects`
        await sql`CREATE POLICY "Users can create own projects" ON projects FOR INSERT WITH CHECK (auth.uid() = owner_id)`
        console.log('  ✅ Create own projects')

        await sql`DROP POLICY IF EXISTS "Users can update own projects" ON projects`
        await sql`CREATE POLICY "Users can update own projects" ON projects FOR UPDATE USING (auth.uid() = owner_id)`
        console.log('  ✅ Update own projects')

        // ============================================
        // 7. Project Members RLS Policies
        // ============================================
        console.log('\n📋 Creating project_members policies...')

        await sql`DROP POLICY IF EXISTS "Project members are viewable" ON project_members`
        await sql`CREATE POLICY "Project members are viewable" ON project_members FOR SELECT USING (true)`
        console.log('  ✅ Members viewable')

        // ============================================
        // 8. Project Files RLS Policies
        // ============================================
        console.log('\n📋 Creating project files policies...')

        await sql`DROP POLICY IF EXISTS project_nodes_read ON project_nodes`
        await sql`CREATE POLICY project_nodes_read ON project_nodes
            FOR SELECT USING (
              EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
              OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
            )`

        await sql`DROP POLICY IF EXISTS project_nodes_public_read ON project_nodes`
        await sql`CREATE POLICY project_nodes_public_read ON project_nodes
            FOR SELECT USING (
              EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.visibility = 'public')
              AND deleted_at IS NULL
            )`

        await sql`DROP POLICY IF EXISTS project_nodes_write ON project_nodes`
        await sql`CREATE POLICY project_nodes_write ON project_nodes
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
            )`
        console.log('  ✅ project_nodes policies')

        await sql`DROP POLICY IF EXISTS project_file_index_read ON project_file_index`
        await sql`CREATE POLICY project_file_index_read ON project_file_index
            FOR SELECT USING (
              EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
              OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
            )`
        await sql`DROP POLICY IF EXISTS project_file_index_public_read ON project_file_index`
        await sql`CREATE POLICY project_file_index_public_read ON project_file_index
            FOR SELECT USING (
              EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.visibility = 'public')
            )`
        await sql`DROP POLICY IF EXISTS project_file_index_write ON project_file_index`
        await sql`CREATE POLICY project_file_index_write ON project_file_index
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
            )`
        console.log('  ✅ project_file_index policies')

        await sql`DROP POLICY IF EXISTS project_node_locks_read ON project_node_locks`
        await sql`CREATE POLICY project_node_locks_read ON project_node_locks
            FOR SELECT USING (
              EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
              OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
            )`
        await sql`DROP POLICY IF EXISTS project_node_locks_write ON project_node_locks`
        await sql`CREATE POLICY project_node_locks_write ON project_node_locks
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
            )`
        console.log('  ✅ project_node_locks policies')

        await sql`DROP POLICY IF EXISTS project_node_events_read ON project_node_events`
        await sql`CREATE POLICY project_node_events_read ON project_node_events
            FOR SELECT USING (
              EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
              OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = project_id AND m.user_id = auth.uid())
            )`
        await sql`DROP POLICY IF EXISTS project_node_events_write ON project_node_events`
        await sql`CREATE POLICY project_node_events_write ON project_node_events
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
            )`
        console.log('  ✅ project_node_events policies')

        console.log('\n📦 Configuring project-files bucket...')
        await sql`INSERT INTO storage.buckets (id, name, public, file_size_limit)
            VALUES ('project-files', 'project-files', false, 10485760)
            ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760`
        await sql`DROP POLICY IF EXISTS project_files_read ON storage.objects`
        await sql`CREATE POLICY project_files_read ON storage.objects
            FOR SELECT USING (
              bucket_id = 'project-files'
              AND split_part(name, '/', 1) = 'projects'
              AND (
                EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 2) AND p.owner_id = auth.uid())
                OR EXISTS (
                  SELECT 1 FROM project_members m
                  WHERE m.project_id::text = split_part(name, '/', 2) AND m.user_id = auth.uid()
                )
              )
            )`
        await sql`DROP POLICY IF EXISTS project_files_public_read ON storage.objects`
        await sql`CREATE POLICY project_files_public_read ON storage.objects
            FOR SELECT USING (
              bucket_id = 'project-files'
              AND split_part(name, '/', 1) = 'projects'
              AND EXISTS (
                SELECT 1 FROM projects p
                WHERE p.id::text = split_part(name, '/', 2)
                  AND p.visibility = 'public'
              )
            )`
        await sql`DROP POLICY IF EXISTS project_files_write ON storage.objects`
        await sql`CREATE POLICY project_files_write ON storage.objects
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
            )`
        console.log('  ✅ project-files storage policies')

        // ============================================
        // 9. Onboarding RLS Policies
        // ============================================
        console.log('\n📋 Creating onboarding policies...')

        await sql`DROP POLICY IF EXISTS "Users can manage own onboarding drafts" ON onboarding_drafts`
        await sql`CREATE POLICY "Users can manage own onboarding drafts" ON onboarding_drafts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
        console.log('  ✅ Onboarding drafts self-scoped')

        await sql`DROP POLICY IF EXISTS "Users can view own onboarding submissions" ON onboarding_submissions`
        await sql`CREATE POLICY "Users can view own onboarding submissions" ON onboarding_submissions FOR SELECT USING (auth.uid() = user_id)`
        await sql`DROP POLICY IF EXISTS "Users can create own onboarding submissions" ON onboarding_submissions`
        await sql`CREATE POLICY "Users can create own onboarding submissions" ON onboarding_submissions FOR INSERT WITH CHECK (auth.uid() = user_id)`
        await sql`DROP POLICY IF EXISTS "Users can update own onboarding submissions" ON onboarding_submissions`
        await sql`CREATE POLICY "Users can update own onboarding submissions" ON onboarding_submissions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
        console.log('  ✅ Onboarding submissions user-scoped')

        await sql`DROP POLICY IF EXISTS "Users can view own onboarding events" ON onboarding_events`
        await sql`CREATE POLICY "Users can view own onboarding events" ON onboarding_events FOR SELECT USING (auth.uid() = user_id)`
        console.log('  ✅ Onboarding events user-readable')

        await sql`DROP POLICY IF EXISTS "Users can view own profile audit events" ON profile_audit_events`
        await sql`CREATE POLICY "Users can view own profile audit events" ON profile_audit_events FOR SELECT USING (auth.uid() = user_id)`
        console.log('  ✅ Profile audit events user-readable')

        // ============================================
        // 10. Analyze Tables for Query Optimization
        // ============================================
        console.log('\n📈 Analyzing tables for optimization...')

        await sql`ANALYZE profiles`
        await sql`ANALYZE connections`
        if (postsExists) {
            await sql`ANALYZE posts`
        }
        await sql`ANALYZE projects`
        await sql`ANALYZE project_members`
        await sql`ANALYZE project_nodes`
        await sql`ANALYZE project_file_index`
        await sql`ANALYZE project_node_locks`
        await sql`ANALYZE project_node_events`
        await sql`ANALYZE onboarding_drafts`
        await sql`ANALYZE onboarding_submissions`
        await sql`ANALYZE onboarding_events`
        await sql`ANALYZE profile_audit_events`
        console.log('  ✅ All tables analyzed')

        // ============================================
        // Done!
        // ============================================
        console.log('\n✅ Database setup complete!\n')
        console.log('Summary:')
        console.log(`  - ${indexesConfiguredCount} performance indexes created`)
        console.log(`  - RLS enabled on ${rlsEnabledTablesCount} tables`)
        console.log(`  - ${securityPoliciesConfiguredCount} security policies configured`)
        console.log('  - Tables analyzed for optimization')

    } catch (error) {
        console.error('❌ Setup error:', error)
        throw error
    } finally {
        await sql.end()
    }
}

// Run setup
setupDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
