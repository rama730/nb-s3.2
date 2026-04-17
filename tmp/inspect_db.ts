import postgres from 'postgres';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('DATABASE_URL not found');
    process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, ssl: 'require' });

async function run() {
    try {
        const users = await sql`SELECT id, username FROM profiles WHERE username IN ('ch_rama', 'ramanayudu_ch')`;
        console.log('USERS:', users);
        
        const ids = users.map(u => u.id);
        if (ids.length >= 2) {
            const conns = await sql`
                SELECT id, requester_id, addressee_id, status, created_at, updated_at FROM connections 
                WHERE (requester_id = ${ids[0]} AND addressee_id = ${ids[1]})
                   OR (requester_id = ${ids[1]} AND addressee_id = ${ids[0]})
            `;
            console.log('CONNECTIONS BETWEEN THEM:', conns);
        } else {
            console.log('Could not find both users!');
             const all_rama = await sql`SELECT id, username FROM profiles WHERE username LIKE '%rama%'`;
             console.log('All variations of rama:', all_rama);
        }
    } catch(e) { console.error(e); } finally { await sql.end(); }
}
run();
