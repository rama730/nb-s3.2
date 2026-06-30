-- drizzle-pg-migration-non-transactional

-- 0. Drop any failed or invalid concurrent index remnants if they exist
DROP INDEX CONCURRENTLY IF EXISTS project_nodes_active_parent_name_uidx_new;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS project_nodes_active_project_path_uidx_new;
--> statement-breakpoint

-- 1. Create the replacement indexes under temporary names concurrently
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS project_nodes_active_parent_name_uidx_new 
ON project_nodes (
  project_id, 
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), 
  LOWER(name), 
  COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS project_nodes_active_project_path_uidx_new 
ON project_nodes (
  project_id, 
  path, 
  COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- 2. Drop the old indexes concurrently (avoids exclusive table locks)
DROP INDEX CONCURRENTLY IF EXISTS project_nodes_active_parent_name_uidx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS project_nodes_active_project_path_uidx;
--> statement-breakpoint

-- 3. Rename the new indexes to match canonical schema references
ALTER INDEX project_nodes_active_parent_name_uidx_new RENAME TO project_nodes_active_parent_name_uidx;
--> statement-breakpoint
ALTER INDEX project_nodes_active_project_path_uidx_new RENAME TO project_nodes_active_project_path_uidx;
