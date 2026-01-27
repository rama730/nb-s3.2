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
        // ============================================
        // 1. Create Indexes for Performance
        // ============================================
        console.log('📊 Creating performance indexes...')

        await sql`CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username)`
        console.log('  ✅ idx_profiles_username')

        await sql`CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id)`
        console.log('  ✅ idx_connections_requester')

        await sql`CREATE INDEX IF NOT EXISTS idx_connections_addressee ON connections(addressee_id)`
        console.log('  ✅ idx_connections_addressee')

        await sql`CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status)`
        console.log('  ✅ idx_connections_status')

        await sql`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id)`
        console.log('  ✅ idx_posts_author')

        await sql`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`
        console.log('  ✅ idx_posts_created_at')

        await sql`CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility)`
        console.log('  ✅ idx_posts_visibility')

        await sql`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`
        console.log('  ✅ idx_projects_owner')

        await sql`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`
        console.log('  ✅ idx_projects_status')

        await sql`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`
        console.log('  ✅ idx_project_members_user')

        await sql`CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)`
        console.log('  ✅ idx_project_members_project')

        // ============================================
        // 2. Enable RLS on all tables
        // ============================================
        console.log('\n🔒 Enabling Row Level Security...')

        await sql`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE connections ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE posts ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE projects ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE project_members ENABLE ROW LEVEL SECURITY`
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
        // 8. Analyze Tables for Query Optimization
        // ============================================
        console.log('\n📈 Analyzing tables for optimization...')

        await sql`ANALYZE profiles`
        await sql`ANALYZE connections`
        await sql`ANALYZE posts`
        await sql`ANALYZE projects`
        await sql`ANALYZE project_members`
        console.log('  ✅ All tables analyzed')

        // ============================================
        // Done!
        // ============================================
        console.log('\n✅ Database setup complete!\n')
        console.log('Summary:')
        console.log('  - 11 performance indexes created')
        console.log('  - RLS enabled on 5 tables')
        console.log('  - 14 security policies configured')
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
