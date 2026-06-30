import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function inspect() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL not found");
        process.exit(1);
    }
    const sql = postgres(connectionString, { max: 1 });

    try {
        console.log("Existing unique index definitions on project_nodes:");
        const indexes = await sql`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'project_nodes'
        `;
        for (const idx of indexes) {
            console.log(`- ${idx.indexname}: ${idx.indexdef}`);
        }

        console.log("\nAttempting to build project_nodes_active_parent_name_uidx_new non-concurrently to see the exact error...");
        try {
            await sql`
                CREATE UNIQUE INDEX project_nodes_active_parent_name_uidx_new 
                ON project_nodes (
                  project_id, 
                  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), 
                  LOWER(name), 
                  COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
                ) WHERE deleted_at IS NULL;
            `;
            console.log("✅ project_nodes_active_parent_name_uidx_new created successfully!");
            // Clean it up
            await sql`DROP INDEX project_nodes_active_parent_name_uidx_new;`;
        } catch (e: any) {
            console.error("❌ Error building parent name index:", e.message);
        }

        console.log("\nAttempting to build project_nodes_active_project_path_uidx_new non-concurrently to see the exact error...");
        try {
            await sql`
                CREATE UNIQUE INDEX project_nodes_active_project_path_uidx_new 
                ON project_nodes (
                  project_id, 
                  path, 
                  COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
                ) WHERE deleted_at IS NULL;
            `;
            console.log("✅ project_nodes_active_project_path_uidx_new created successfully!");
            // Clean it up
            await sql`DROP INDEX project_nodes_active_project_path_uidx_new;`;
        } catch (e: any) {
            console.error("❌ Error building project path index:", e.message);
        }

    } finally {
        await sql.end();
    }
}

inspect();
