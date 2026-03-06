/**
 * Messaging Setup Script
 * Runs migrations for the messaging system
 * Run with: npx tsx scripts/setup-messaging.ts
 */

import postgres from 'postgres'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

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

async function setupMessaging() {
    console.log('🚀 Starting messaging system setup...\n')

    try {
        // ============================================
        // 1. Create Conversations Table
        // ============================================
        console.log('📊 Creating conversations table...')

        await sql`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                type TEXT NOT NULL DEFAULT 'dm' CHECK (type IN ('dm', 'group')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `
        console.log('  ✅ conversations table created')

        // ============================================
        // 2. Create Conversation Participants Table
        // ============================================
        console.log('📊 Creating conversation_participants table...')

        await sql`
            CREATE TABLE IF NOT EXISTS conversation_participants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                last_read_at TIMESTAMPTZ,
                muted BOOLEAN NOT NULL DEFAULT false,
                UNIQUE(conversation_id, user_id)
            )
        `
        console.log('  ✅ conversation_participants table created')

        // ============================================
        // 3. Create Messages Table
        // ============================================
        console.log('📊 Creating messages table...')

        await sql`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
                content TEXT,
                type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'file', 'system')),
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                edited_at TIMESTAMPTZ,
                deleted_at TIMESTAMPTZ,
                search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED
            )
        `
        console.log('  ✅ messages table created')

        // ============================================
        // 4. Create Message Attachments Table
        // ============================================
        console.log('📊 Creating message_attachments table...')

        await sql`
            CREATE TABLE IF NOT EXISTS message_attachments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK (type IN ('image', 'video', 'file')),
                url TEXT NOT NULL,
                filename TEXT NOT NULL,
                size_bytes INTEGER,
                mime_type TEXT,
                thumbnail_url TEXT,
                width INTEGER,
                height INTEGER,
                duration_seconds INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `
        console.log('  ✅ message_attachments table created')

        // ============================================
        // 5. Create Indexes
        // ============================================
        console.log('\n📊 Creating indexes...')

        await sql`CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)`
        console.log('  ✅ idx_conversations_updated')

        await sql`CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id)`
        console.log('  ✅ idx_participants_user')

        await sql`CREATE INDEX IF NOT EXISTS idx_participants_conversation ON conversation_participants(conversation_id)`
        console.log('  ✅ idx_participants_conversation')

        await sql`CREATE INDEX IF NOT EXISTS idx_participants_user_read ON conversation_participants(user_id, last_read_at)`
        console.log('  ✅ idx_participants_user_read')

        await sql`CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC)`
        console.log('  ✅ idx_messages_conversation_created')

        await sql`CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN(search_vector)`
        console.log('  ✅ idx_messages_search (GIN)')

        await sql`CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id)`
        console.log('  ✅ idx_attachments_message')

        // ============================================
        // 6. Enable RLS
        // ============================================
        console.log('\n🔒 Enabling Row Level Security...')

        await sql`ALTER TABLE conversations ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE messages ENABLE ROW LEVEL SECURITY`
        await sql`ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY`
        console.log('  ✅ RLS enabled on all messaging tables')

        // ============================================
        // 7. Create RLS Policies - Conversations
        // ============================================
        console.log('\n📋 Creating conversations policies...')

        await sql`DROP POLICY IF EXISTS "Users can view their conversations" ON conversations`
        await sql`
            CREATE POLICY "Users can view their conversations" ON conversations FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM conversation_participants cp
                    WHERE cp.conversation_id = id AND cp.user_id = auth.uid()
                )
            )
        `
        console.log('  ✅ View own conversations')

        await sql`DROP POLICY IF EXISTS "Authenticated users can create conversations" ON conversations`
        await sql`
            CREATE POLICY "Authenticated users can create conversations" ON conversations FOR INSERT 
            WITH CHECK (auth.uid() IS NOT NULL)
        `
        console.log('  ✅ Create conversations')

        // ============================================
        // 8. Create RLS Policies - Participants
        // ============================================
        console.log('\n📋 Creating conversation_participants policies...')

        await sql`DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants`
        await sql`
            CREATE POLICY "Users can view participants of their conversations" ON conversation_participants FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM conversation_participants cp
                    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
                )
            )
        `
        console.log('  ✅ View participants')

        await sql`DROP POLICY IF EXISTS "Users can add themselves to conversations" ON conversation_participants`
        await sql`
            CREATE POLICY "Users can add themselves to conversations" ON conversation_participants FOR INSERT 
            WITH CHECK (auth.uid() IS NOT NULL)
        `
        console.log('  ✅ Add to conversations')

        await sql`DROP POLICY IF EXISTS "Users can update their own participation" ON conversation_participants`
        await sql`
            CREATE POLICY "Users can update their own participation" ON conversation_participants FOR UPDATE 
            USING (user_id = auth.uid())
        `
        console.log('  ✅ Update participation')

        // ============================================
        // 9. Create RLS Policies - Messages
        // ============================================
        console.log('\n📋 Creating messages policies...')

        await sql`DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages`
        await sql`
            CREATE POLICY "Users can view messages in their conversations" ON messages FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM conversation_participants cp
                    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
                )
            )
        `
        console.log('  ✅ View messages')

        await sql`DROP POLICY IF EXISTS "Users can send messages to their conversations" ON messages`
        await sql`
            CREATE POLICY "Users can send messages to their conversations" ON messages FOR INSERT WITH CHECK (
                sender_id = auth.uid() AND EXISTS (
                    SELECT 1 FROM conversation_participants cp
                    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
                )
            )
        `
        console.log('  ✅ Send messages')

        await sql`DROP POLICY IF EXISTS "Users can edit their own messages" ON messages`
        await sql`
            CREATE POLICY "Users can edit their own messages" ON messages FOR UPDATE 
            USING (sender_id = auth.uid())
        `
        console.log('  ✅ Edit own messages')

        await sql`DROP POLICY IF EXISTS "Users can delete their own messages" ON messages`
        await sql`
            CREATE POLICY "Users can delete their own messages" ON messages FOR DELETE 
            USING (sender_id = auth.uid())
        `
        console.log('  ✅ Delete own messages')

        // ============================================
        // 10. Create RLS Policies - Attachments
        // ============================================
        console.log('\n📋 Creating message_attachments policies...')

        await sql`DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON message_attachments`
        await sql`
            CREATE POLICY "Users can view attachments in their conversations" ON message_attachments FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM messages m
                    JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
                    WHERE m.id = message_id AND cp.user_id = auth.uid()
                )
            )
        `
        console.log('  ✅ View attachments')

        await sql`DROP POLICY IF EXISTS "Users can add attachments to their messages" ON message_attachments`
        await sql`
            CREATE POLICY "Users can add attachments to their messages" ON message_attachments FOR INSERT WITH CHECK (
                EXISTS (
                    SELECT 1 FROM messages m
                    WHERE m.id = message_id AND m.sender_id = auth.uid()
                )
            )
        `
        console.log('  ✅ Add attachments')

        // ============================================
        // 11. Create Trigger for updating conversation timestamp
        // ============================================
        console.log('\n⚡ Creating triggers...')

        await sql`
            CREATE OR REPLACE FUNCTION update_conversation_timestamp()
            RETURNS TRIGGER 
            SET search_path = ''
            AS $$
            BEGIN
                UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `

        await sql`DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages`
        await sql`
            CREATE TRIGGER trigger_update_conversation_timestamp
            AFTER INSERT ON messages
            FOR EACH ROW
            EXECUTE FUNCTION update_conversation_timestamp()
        `
        console.log('  ✅ Conversation timestamp trigger')

        // ============================================
        // 12. Enable Realtime for messages table
        // ============================================
        console.log('\n📡 Configuring Realtime...')

        // Check if supabase_realtime publication exists and add messages table
        try {
            await sql`ALTER PUBLICATION supabase_realtime ADD TABLE messages`
            console.log('  ✅ Messages table added to supabase_realtime publication')
        } catch (e: any) {
            if (e.message.includes('already member')) {
                console.log('  ℹ️ Messages table already in supabase_realtime publication')
            } else {
                console.log('  ⚠️ Could not add to realtime publication:', e.message)
            }
        }

        // ============================================
        // 13. Analyze tables
        // ============================================
        console.log('\n📈 Analyzing tables...')
        await sql`ANALYZE conversations`
        await sql`ANALYZE conversation_participants`
        await sql`ANALYZE messages`
        await sql`ANALYZE message_attachments`
        console.log('  ✅ All tables analyzed')

        // ============================================
        // Done!
        // ============================================
        console.log('\n✅ Messaging system setup complete!\n')
        console.log('Summary:')
        console.log('  - 4 messaging tables created')
        console.log('  - 7 performance indexes created')
        console.log('  - RLS enabled on all tables')
        console.log('  - 10 security policies configured')
        console.log('  - Realtime enabled for messages')

    } catch (error) {
        console.error('❌ Setup error:', error)
        throw error
    } finally {
        await sql.end()
    }
}

// Run setup
setupMessaging()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
