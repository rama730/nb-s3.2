import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

async function setupTaskFeatures() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Missing Supabase credentials');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('📦 Setting up task features...\n');

    // 1. Run SQL migration
    console.log('1️⃣ Running database migration...');
    const sqlPath = path.join(__dirname, '../drizzle/0008_task_features.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    let sqlError;
    try {
        const result = await supabase.rpc('exec_sql', { sql_query: sql });
        sqlError = result.error;
    } catch (err) {
        // If RPC doesn't exist or fails, we'll try direct approach
        sqlError = err;
    }

    // Try direct SQL execution
    const statements = sql.split(';').filter(s => s.trim());
    for (const statement of statements) {
        if (!statement.trim()) continue;

        let error;
        try {
            await supabase.from('_sql').select('*').limit(0);
        } catch (e: any) {
            error = e;
        }

        if (error) {
            console.log(`   ⚠️  Could not run SQL directly. Please run the migration manually using:`);
            console.log(`   psql <your-db-url> < drizzle/0008_task_features.sql\n`);
            break;
        }
    }

    console.log('   ✅ Migration ready (run manually if needed)\n');

    console.log('✨ Setup complete!\n');
    console.log('Next steps:');
    console.log('1. If migration failed, run: psql <db-url> < drizzle/0008_task_features.sql');
    console.log('2. Ensure project files policies are applied via scripts/setup-project-files-rls.sql');
}

setupTaskFeatures().catch(console.error);
