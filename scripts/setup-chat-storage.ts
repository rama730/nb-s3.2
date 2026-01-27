/**
 * Chat Storage Setup Script
 * Creates the chat-attachments bucket and policies
 * Run with: npx tsx scripts/setup-chat-storage.ts
 */

import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const DATABASE_URL = process.env.DATABASE_URL

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL or SUPABASE_KEY not found in .env.local')
    console.log('Required: NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY')
    process.exit(1)
}

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env.local')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const sql = postgres(DATABASE_URL, { prepare: false, ssl: 'require' })

async function setupChatStorage() {
    console.log('🚀 Setting up chat attachments storage...\n')

    try {
        // ============================================
        // 1. Create Storage Bucket
        // ============================================
        console.log('📦 Creating chat-attachments bucket...')

        const { data: existingBuckets, error: listError } = await supabase.storage.listBuckets()

        if (listError) {
            console.log('  ⚠️ Could not list buckets (may need service role key):', listError.message)
        }

        const bucketExists = existingBuckets?.some(b => b.id === 'chat-attachments')

        if (bucketExists) {
            console.log('  ℹ️ chat-attachments bucket already exists')
        } else {
            const { data, error } = await supabase.storage.createBucket('chat-attachments', {
                public: false,
                fileSizeLimit: 52428800, // 50MB
                allowedMimeTypes: [
                    'image/jpeg',
                    'image/png',
                    'image/gif',
                    'image/webp',
                    'video/mp4',
                    'video/webm',
                    'video/quicktime',
                    'application/pdf',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'text/plain'
                ]
            })

            if (error) {
                if (error.message.includes('already exists')) {
                    console.log('  ℹ️ chat-attachments bucket already exists')
                } else {
                    console.log('  ⚠️ Could not create bucket via API:', error.message)
                    console.log('  📋 Creating bucket via SQL instead...')

                    // Try creating via direct SQL
                    try {
                        await sql`
                            INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
                            VALUES (
                                'chat-attachments',
                                'chat-attachments',
                                false,
                                52428800,
                                ARRAY[
                                    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                                    'video/mp4', 'video/webm', 'video/quicktime',
                                    'application/pdf', 'application/msword',
                                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                    'text/plain'
                                ]
                            ) ON CONFLICT (id) DO NOTHING
                        `
                        console.log('  ✅ Bucket created via SQL')
                    } catch (sqlError: any) {
                        console.log('  ⚠️ SQL bucket creation:', sqlError.message)
                    }
                }
            } else {
                console.log('  ✅ chat-attachments bucket created')
            }
        }

        // ============================================
        // 2. Create Storage Policies via SQL
        // ============================================
        console.log('\n🔒 Creating storage policies...')

        // Upload policy
        try {
            await sql`DROP POLICY IF EXISTS "Users can upload chat attachments" ON storage.objects`
            await sql`
                CREATE POLICY "Users can upload chat attachments"
                ON storage.objects FOR INSERT TO authenticated
                WITH CHECK (
                    bucket_id = 'chat-attachments' 
                    AND (storage.foldername(name))[1] = auth.uid()::text
                )
            `
            console.log('  ✅ Upload policy created')
        } catch (e: any) {
            console.log('  ⚠️ Upload policy:', e.message)
        }

        // View policy (simpler version that allows viewing all chat attachments for authenticated users)
        try {
            await sql`DROP POLICY IF EXISTS "Users can view chat attachments" ON storage.objects`
            await sql`
                CREATE POLICY "Users can view chat attachments"
                ON storage.objects FOR SELECT TO authenticated
                USING (bucket_id = 'chat-attachments')
            `
            console.log('  ✅ View policy created')
        } catch (e: any) {
            console.log('  ⚠️ View policy:', e.message)
        }

        // Delete policy
        try {
            await sql`DROP POLICY IF EXISTS "Users can delete their own attachments" ON storage.objects`
            await sql`
                CREATE POLICY "Users can delete their own attachments"
                ON storage.objects FOR DELETE TO authenticated
                USING (
                    bucket_id = 'chat-attachments'
                    AND (storage.foldername(name))[1] = auth.uid()::text
                )
            `
            console.log('  ✅ Delete policy created')
        } catch (e: any) {
            console.log('  ⚠️ Delete policy:', e.message)
        }

        // ============================================
        // Done!
        // ============================================
        console.log('\n✅ Chat storage setup complete!\n')
        console.log('Summary:')
        console.log('  - chat-attachments bucket configured')
        console.log('  - 50MB file size limit')
        console.log('  - Storage policies for upload/view/delete')

    } catch (error) {
        console.error('❌ Setup error:', error)
        throw error
    } finally {
        await sql.end()
    }
}

// Run setup
setupChatStorage()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
