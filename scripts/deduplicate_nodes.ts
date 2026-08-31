import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function deduplicate() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL not found");
        process.exit(1);
    }
    const sql = postgres(connectionString, { max: 1 });

    try {
        console.log("Starting database deduplication for project_nodes (Bulk Execution Mode)...");

        await sql.begin(async (tx: any) => {
            // 1. Create temporary table of nodes to keep (rn = 1)
            console.log("Step 1: Identifying nodes to keep...");
            await tx`
                CREATE TEMP TABLE nodes_to_keep AS
                WITH RankedNodes AS (
                    SELECT id, project_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid) as task_id,
                           ROW_NUMBER() OVER (
                               PARTITION BY project_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
                               ORDER BY updated_at DESC, created_at DESC
                           ) as rn
                    FROM project_nodes
                    WHERE deleted_at IS NULL
                )
                SELECT id, project_id, path, task_id
                FROM RankedNodes
                WHERE rn = 1;
            `;

            // 2. Create temporary table of nodes to discard (rn > 1)
            console.log("Step 2: Identifying duplicate nodes to discard...");
            await tx`
                CREATE TEMP TABLE nodes_to_discard AS
                WITH RankedNodes AS (
                    SELECT id, project_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid) as task_id,
                           ROW_NUMBER() OVER (
                               PARTITION BY project_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
                               ORDER BY updated_at DESC, created_at DESC
                           ) as rn
                    FROM project_nodes
                    WHERE deleted_at IS NULL
                )
                SELECT id, project_id, path, task_id
                FROM RankedNodes
                WHERE rn > 1;
            `;

            const discardCountResult = await tx`SELECT COUNT(*) FROM nodes_to_discard;`;
            const count = discardCountResult[0]?.count ?? "0";
            console.log(`Found ${count} duplicate nodes to discard.`);

            if (parseInt(count, 10) > 0) {
                const activeLeaseCountResult = await tx`
                    SELECT COUNT(*)
                    FROM project_node_locks
                    WHERE node_id IN (SELECT id FROM nodes_to_discard)
                      AND expires_at > NOW();
                `;
                const activeLeaseCount = parseInt(activeLeaseCountResult[0]?.count ?? "0", 10);
                if (activeLeaseCount > 0) {
                    throw new Error(
                        `Deduplication aborted: ${activeLeaseCount} duplicate node(s) have active editing leases.`
                    );
                }

                // 3. Delete file_versions of discarded nodes
                console.log("Step 3: Deleting duplicate file_versions...");
                await tx`
                    DELETE FROM file_versions 
                    WHERE node_id IN (SELECT id FROM nodes_to_discard);
                `;

                // 4. Delete locks of discarded nodes
                console.log("Step 4: Deleting locks of duplicate nodes...");
                await tx`
                    DELETE FROM project_node_locks 
                    WHERE node_id IN (SELECT id FROM nodes_to_discard)
                      AND expires_at <= NOW();
                `;

                // 5. Update events to point to kept nodes
                console.log("Step 5: Remapping project_node_events to kept nodes...");
                await tx`
                    UPDATE project_node_events pne
                    SET node_id = k.id
                    FROM nodes_to_discard d
                    JOIN nodes_to_keep k ON k.project_id = d.project_id AND k.path = d.path AND k.task_id = d.task_id
                    WHERE pne.node_id = d.id;
                `;

                // 6. Update task_node_links to point to kept nodes
                console.log("Step 6: Remapping task_node_links to kept nodes...");
                await tx`
                    UPDATE task_node_links tnl
                    SET node_id = k.id
                    FROM nodes_to_discard d
                    JOIN nodes_to_keep k ON k.project_id = d.project_id AND k.path = d.path AND k.task_id = d.task_id
                    WHERE tnl.node_id = d.id;
                `;

                // 7. Update project_git_deltas to point to kept nodes
                console.log("Step 7: Remapping project_git_deltas to kept nodes...");
                await tx`
                    UPDATE project_git_deltas pgd
                    SET node_id = k.id
                    FROM nodes_to_discard d
                    JOIN nodes_to_keep k ON k.project_id = d.project_id AND k.path = d.path AND k.task_id = d.task_id
                    WHERE pgd.node_id = d.id;
                `;

                // 8. Delete project_file_index of discarded nodes
                console.log("Step 8: Deleting duplicate project_file_index entries...");
                await tx`
                    DELETE FROM project_file_index 
                    WHERE node_id IN (SELECT id FROM nodes_to_discard);
                `;

                // 9. Delete duplicate project_nodes
                console.log("Step 9: Deleting duplicate project_nodes...");
                await tx`
                    DELETE FROM project_nodes 
                    WHERE id IN (SELECT id FROM nodes_to_discard);
                `;
            }

            // Clean up temp tables
            await tx`DROP TABLE nodes_to_keep;`;
            await tx`DROP TABLE nodes_to_discard;`;
        });

        // Build and validate replacements before swapping names. The currently
        // active indexes remain in place throughout, so a failed build cannot
        // leave a uniqueness gap.
        console.log("Step 10: Building replacement unique indexes...");
        const existingReplacements = await sql<{
            name: string;
            valid: boolean;
            unique: boolean;
        }[]>`
            SELECT c.relname AS name, i.indisvalid AS valid, i.indisunique AS unique
            FROM pg_class c
            JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname IN (
              'project_nodes_active_parent_name_uidx_replacement',
              'project_nodes_active_project_path_uidx_replacement'
            )
        `;
        const replacementByName = new Map(existingReplacements.map((row) => [row.name, row]));

        const parentReplacement = replacementByName.get('project_nodes_active_parent_name_uidx_replacement');
        if (parentReplacement && (!parentReplacement.valid || !parentReplacement.unique)) {
            await sql`DROP INDEX CONCURRENTLY project_nodes_active_parent_name_uidx_replacement`;
        }
        if (!parentReplacement || !parentReplacement.valid || !parentReplacement.unique) {
          await sql`
            CREATE UNIQUE INDEX CONCURRENTLY project_nodes_active_parent_name_uidx_replacement
            ON project_nodes (
              project_id, 
              COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), 
              LOWER(name), 
              COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
            ) WHERE deleted_at IS NULL;
          `;
        }

        const pathReplacement = replacementByName.get('project_nodes_active_project_path_uidx_replacement');
        if (pathReplacement && (!pathReplacement.valid || !pathReplacement.unique)) {
            await sql`DROP INDEX CONCURRENTLY project_nodes_active_project_path_uidx_replacement`;
        }
        if (!pathReplacement || !pathReplacement.valid || !pathReplacement.unique) {
          await sql`
            CREATE UNIQUE INDEX CONCURRENTLY project_nodes_active_project_path_uidx_replacement
            ON project_nodes (
              project_id, 
              path, 
              COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
            ) WHERE deleted_at IS NULL;
          `;
        }

        const [verification] = await sql<{ valid_count: number }[]>`
            SELECT COUNT(*)::int AS valid_count
            FROM pg_class c
            JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname IN (
              'project_nodes_active_parent_name_uidx_replacement',
              'project_nodes_active_project_path_uidx_replacement'
            )
              AND i.indisvalid
              AND i.indisunique
        `;
        if (verification?.valid_count !== 2) {
            throw new Error('Replacement unique indexes did not validate');
        }

        await sql.begin(async (tx) => {
            const transaction = tx as unknown as typeof sql;
            await transaction`DROP INDEX IF EXISTS project_nodes_active_parent_name_uidx`;
            await transaction`DROP INDEX IF EXISTS project_nodes_active_project_path_uidx`;
            await transaction`ALTER INDEX project_nodes_active_parent_name_uidx_replacement RENAME TO project_nodes_active_parent_name_uidx`;
            await transaction`ALTER INDEX project_nodes_active_project_path_uidx_replacement RENAME TO project_nodes_active_project_path_uidx`;
        });

        console.log("✅ Bulk deduplication and index building finished successfully.");
    } catch (e: any) {
        console.error("❌ Bulk deduplication failed:", e.message);
        throw e;
    } finally {
        await sql.end();
    }
}

deduplicate();
