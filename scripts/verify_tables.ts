
import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function verify() {
    try {
        console.log("Verifying database tables...");

        // Check tables in information_schema
        const tablesToCheck = ['project_nodes', 'project_file_index', 'project_node_locks', 'project_node_events'];

        for (const tableName of tablesToCheck) {
            const result = await db.execute(sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = ${tableName}
        `);

            if (result.length > 0) {
                console.log(`✅ Table '${tableName}' exists.`);
            } else {
                console.log(`❌ Table '${tableName}' DOES NOT EXIST.`);
            }
        }

        process.exit(0);
    } catch (error: any) {
        console.error("❌ Verification failed:", error.message);
        process.exit(1);
    }
}

verify();
