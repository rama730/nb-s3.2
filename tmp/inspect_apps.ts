import postgres from 'postgres';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL, { prepare: false, ssl: 'require' });

async function run() {
    try {
        const users = await sql`SELECT id, username FROM profiles WHERE username IN ('ch_rama', 'ramanayudu_ch')`;
        const ids = users.map(u => u.id);
        if (ids.length >= 2) {
            const apps = await sql`
                SELECT id, applicant_id, creator_id, status FROM role_applications 
                WHERE (applicant_id = ${ids[0]} AND creator_id = ${ids[1]})
                   OR (applicant_id = ${ids[1]} AND creator_id = ${ids[0]})
            `;
            console.log('ACTIVE APPS BETWEEN THEM:', apps);
        }
    } catch(e) { console.error(e); } finally { await sql.end(); }
}
run();
