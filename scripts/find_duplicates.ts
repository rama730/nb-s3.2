import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function find() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        process.exit(1);
    }
    const sql = postgres(connectionString, { max: 1 });

    try {
        console.log("Finding duplicates by (project_id, path, task_id)...");
        const pathDuplicates = await sql`
            SELECT project_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid) as task_id, COUNT(*)
            FROM project_nodes
            WHERE deleted_at IS NULL
            GROUP BY project_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
            HAVING COUNT(*) > 1
        `;
        console.log("Path duplicates:", pathDuplicates);

        console.log("Finding duplicates by (project_id, parent_id, lower(name), task_id)...");
        const nameDuplicates = await sql`
            SELECT project_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) as parent_id, LOWER(name) as name, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid) as task_id, COUNT(*)
            FROM project_nodes
            WHERE deleted_at IS NULL
            GROUP BY project_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(name), COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
            HAVING COUNT(*) > 1
        `;
        console.log("Name duplicates:", nameDuplicates);
    } finally {
        await sql.end();
    }
}

find();
