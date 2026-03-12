import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db } from './src/lib/db';
import { sql } from 'drizzle-orm';

async function main() {
    try {
        const res = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
        console.log("Tables:", (res as any).rows.map((r: any) => r.table_name));

        const res2 = await db.execute(sql`SELECT routine_definition FROM information_schema.routines WHERE routine_name='update_conversation_timestamp'`);
        console.log("Function definition:", (res2 as any).rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
main();
