
import { db } from '../src/lib/db';
import { sql } from 'drizzle-orm';

async function main() {
    try {
        console.log("Checking database connection...");
        const res = await db.execute(sql`SELECT * FROM pg_extension WHERE extname = 'pg_trgm'`);
        console.log("pg_trgm extension status:", res);

        console.log("Checking simple project query...");
        const projects = await db.execute(sql`SELECT id FROM projects LIMIT 1`);
        console.log("Projects query success:", projects.length);

        process.exit(0);
    } catch (error) {
        console.error("DB Check Failed:", error);
        process.exit(1);
    }
}

main();
