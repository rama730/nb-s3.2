
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env.local');
    process.exit(1);
}

const sql = postgres(DATABASE_URL, {
    prepare: false,
    ssl: 'require'
});

async function analyze() {
    console.log('--- Analyzing Profiles ---');
    
    // Find emails with multiple profiles
    try {
        const duplicates = await sql`
            SELECT email, count(*), array_agg(id) as ids, array_agg(username) as usernames
            FROM profiles
            GROUP BY email
            HAVING count(*) > 1
        `;

        console.log(`Found ${duplicates.length} emails with multiple profiles:`);
        console.log(JSON.stringify(duplicates, null, 2));

        // Find users with same username (should be impossible due to unique constraint, but let's check lowerCase)
        const usernameDupes = await sql`
            SELECT lower(username) as l_username, count(*), array_agg(id) as ids, array_agg(email) as emails
            FROM profiles
            WHERE username IS NOT NULL
            GROUP BY lower(username)
            HAVING count(*) > 1
        `;
        console.log(`\nFound ${usernameDupes.length} duplicate usernames (case-insensitive):`);
        console.log(JSON.stringify(usernameDupes, null, 2));

        // List all profiles to see recent ones
        const recent = await sql`
            SELECT id, email, username, created_at
            FROM profiles
            ORDER BY created_at DESC
            LIMIT 20
        `;

        console.log('\n--- 20 Most Recent Profiles ---');
        console.log(JSON.stringify(recent, null, 2));

    } catch (error) {
        console.error('Error during analysis:', error);
    } finally {
        await sql.end();
    }
}

analyze().catch(console.error);
