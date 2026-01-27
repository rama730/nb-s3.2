/**
 * Quick Storage Setup Script
 * Creates avatars bucket and policies via direct SQL
 */

import postgres from 'postgres'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found')
    process.exit(1)
}

const sql = postgres(DATABASE_URL, { prepare: false, ssl: 'require' })

async function setupStorage() {
    console.log('🚀 Setting up storage bucket...\n')

    try {
        // Create avatars bucket
        await sql`
            INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
            VALUES ('avatars', 'avatars', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp'])
            ON CONFLICT (id) DO UPDATE SET 
                public = true, 
                file_size_limit = 1048576,
                allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
        `
        console.log('✅ Avatars bucket created')

        // Storage policies
        await sql`DROP POLICY IF EXISTS "Avatar public read" ON storage.objects`
        await sql`CREATE POLICY "Avatar public read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars')`
        console.log('✅ Public read policy')

        await sql`DROP POLICY IF EXISTS "Avatar owner upload" ON storage.objects`
        await sql`CREATE POLICY "Avatar owner upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = split_part(name, '-', 1))`
        console.log('✅ Owner upload policy')

        await sql`DROP POLICY IF EXISTS "Avatar owner update" ON storage.objects`
        await sql`CREATE POLICY "Avatar owner update" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = split_part(name, '-', 1))`
        console.log('✅ Owner update policy')

        await sql`DROP POLICY IF EXISTS "Avatar owner delete" ON storage.objects`
        await sql`CREATE POLICY "Avatar owner delete" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = split_part(name, '-', 1))`
        console.log('✅ Owner delete policy')

        console.log('\n✅ Storage setup complete!')

    } catch (error: unknown) {
        const err = error as Error
        console.error('❌ Error:', err.message)
    } finally {
        await sql.end()
    }
}

setupStorage()
