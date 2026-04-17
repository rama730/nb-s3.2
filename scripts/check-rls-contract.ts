import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function main() {
    const root = process.cwd()
    const schemaSource = await readFile(path.join(root, 'src/lib/db/schema/index.ts'), 'utf8')
    const migrationSource = await readFile(path.join(root, 'drizzle/0061_profile_security_state_privacy_rls.sql'), 'utf8')
    const uploadMigrationSource = await readFile(path.join(root, 'drizzle/0062_upload_intents_and_recovery_redemptions.sql'), 'utf8')
    const authorityBackfillSource = await readFile(path.join(root, 'drizzle/0063_database_setup_authority_backfill.sql'), 'utf8')
    const deliveryReceiptSource = await readFile(path.join(root, 'drizzle/0066_message_delivery_receipts.sql'), 'utf8')
    const readReceiptSource = await readFile(path.join(root, 'drizzle/0067_read_receipts_conversation_id.sql'), 'utf8')
    const setupSource = await readFile(path.join(root, 'scripts/setup-database.ts'), 'utf8')

    const checks: Array<[string, boolean]> = [
        ['schema defines private profile security table', schemaSource.includes('export const profileSecurityStates = pgTable(\'profile_security_states\'' )],
        ['migration creates profile security table', migrationSource.includes('CREATE TABLE IF NOT EXISTS "profile_security_states"')],
        ['migration drops legacy profile recovery-code columns', migrationSource.includes('ALTER TABLE "profiles" DROP COLUMN IF EXISTS "security_recovery_codes"')],
        ['migration creates upload intents table', uploadMigrationSource.includes('CREATE TABLE IF NOT EXISTS "upload_intents"')],
        ['migration creates recovery code redemptions table', uploadMigrationSource.includes('CREATE TABLE IF NOT EXISTS "recovery_code_redemptions"')],
        ['migration defines private profile security policies', migrationSource.includes('CREATE POLICY "Users can view own profile security state"')],
        ['migration enforces privacy-aware profile reads', migrationSource.includes('CREATE POLICY "Profiles are viewable by allowed users"')],
        ['migration enforces upload intent self policies', uploadMigrationSource.includes('CREATE POLICY "Users can view own upload intents"')],
        ['migration enforces recovery-code redemption uniqueness', uploadMigrationSource.includes('recovery_code_redemptions_user_code_uidx')],
        ['authority backfill migration codifies project storage policies', authorityBackfillSource.includes('CREATE POLICY project_files_write')],
        ['authority backfill migration codifies connection policies', authorityBackfillSource.includes('CREATE POLICY "Users can view own connections"')],
        ['delivery receipts migration creates the delivery table', deliveryReceiptSource.includes('CREATE TABLE IF NOT EXISTS "message_delivery_receipts"')],
        ['delivery receipts migration defines delivery receipt read policy', deliveryReceiptSource.includes('CREATE POLICY "Users can view delivery receipts in their conversations"')],
        ['delivery receipts migration defines delivery receipt insert policy', deliveryReceiptSource.includes('CREATE POLICY "Users can insert their own delivery receipts"')],
        ['delivery receipts migration publishes delivery receipts to supabase realtime', deliveryReceiptSource.includes('ALTER PUBLICATION supabase_realtime ADD TABLE "message_delivery_receipts"')],
        ['read receipts migration denormalizes conversation_id', readReceiptSource.includes('ADD COLUMN IF NOT EXISTS "conversation_id" uuid')],
        ['read receipts migration defines read receipt read policy', readReceiptSource.includes('CREATE POLICY "Users can view read receipts in their conversations"')],
        ['read receipts migration defines read receipt insert policy', readReceiptSource.includes('CREATE POLICY "Users can upsert their own read receipts"')],
        ['read receipts migration publishes read receipts to supabase realtime', readReceiptSource.includes('ALTER PUBLICATION supabase_realtime ADD TABLE "message_read_receipts"')],
        ['database setup replays migration journal instead of authoring policies directly', setupSource.includes('Starting database setup via Drizzle migrations')],
        ['database setup no longer creates policies directly', !setupSource.includes('CREATE POLICY')],
        ['database setup no longer references supabase-setup.sql', !setupSource.includes('supabase-setup.sql')],
    ]

    const failed = checks.filter(([, passed]) => !passed)
    if (failed.length > 0) {
        throw new Error(`RLS contract failed: ${failed.map(([label]) => label).join(', ')}`)
    }

    console.log('[rls-contract] ok')
}

main().catch((error) => {
    console.error('[rls-contract] failed:', error)
    process.exit(1)
})

export {}
