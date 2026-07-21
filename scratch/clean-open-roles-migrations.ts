import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
}

async function main() {
    const sql = postgres(DATABASE_URL, { prepare: false });
    try {
        console.log("Removing migration journal entries from DB...");
        await sql`
            DELETE FROM app_migration_journal
            WHERE tag IN ('0119_open_roles_ecosystem', '0120_open_roles_count', '0121_open_roles_count_trigger')
        `;
        console.log("Successfully cleaned up database journal entries for re-migration.");
    } catch (e) {
        console.error("Error cleaning up database:", e);
    } finally {
        await sql.end();
    }
}

main();
