ALTER TABLE "connections"
DROP CONSTRAINT IF EXISTS "connections_no_self_check";
--> statement-breakpoint
ALTER TABLE "connections"
ADD CONSTRAINT "connections_no_self_check"
CHECK ("requester_id" <> "addressee_id") NOT VALID;
--> statement-breakpoint

ALTER TABLE "project_open_roles"
DROP CONSTRAINT IF EXISTS "project_open_roles_count_non_negative_check";
--> statement-breakpoint
ALTER TABLE "project_open_roles"
ADD CONSTRAINT "project_open_roles_count_non_negative_check"
CHECK ("count" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "project_open_roles"
DROP CONSTRAINT IF EXISTS "project_open_roles_filled_non_negative_check";
--> statement-breakpoint
ALTER TABLE "project_open_roles"
ADD CONSTRAINT "project_open_roles_filled_non_negative_check"
CHECK ("filled" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "project_open_roles"
DROP CONSTRAINT IF EXISTS "project_open_roles_filled_lte_count_check";
--> statement-breakpoint
ALTER TABLE "project_open_roles"
ADD CONSTRAINT "project_open_roles_filled_lte_count_check"
CHECK ("filled" <= "count") NOT VALID;
--> statement-breakpoint

ALTER TABLE "project_nodes"
DROP CONSTRAINT IF EXISTS "project_nodes_no_self_parent_check";
--> statement-breakpoint
ALTER TABLE "project_nodes"
ADD CONSTRAINT "project_nodes_no_self_parent_check"
CHECK ("parent_id" IS NULL OR "parent_id" <> "id") NOT VALID;
--> statement-breakpoint

ALTER TABLE "role_applications" DROP CONSTRAINT IF EXISTS "role_applications_creator_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "role_applications"
ADD CONSTRAINT "role_applications_creator_id_profiles_id_fk"
FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_nodes" DROP CONSTRAINT IF EXISTS "project_nodes_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_nodes"
ADD CONSTRAINT "project_nodes_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_node_events" DROP CONSTRAINT IF EXISTS "project_node_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_node_events"
ADD CONSTRAINT "project_node_events_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_run_profiles" DROP CONSTRAINT IF EXISTS "project_run_profiles_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_profiles"
ADD CONSTRAINT "project_run_profiles_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_run_sessions" DROP CONSTRAINT IF EXISTS "project_run_sessions_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_sessions"
ADD CONSTRAINT "project_run_sessions_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_run_logs" DROP CONSTRAINT IF EXISTS "project_run_logs_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_logs"
ADD CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk"
FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_run_logs" DROP CONSTRAINT IF EXISTS "project_run_logs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_logs"
ADD CONSTRAINT "project_run_logs_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT IF EXISTS "project_run_diagnostics_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics"
ADD CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk"
FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT IF EXISTS "project_run_diagnostics_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics"
ADD CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_skills" DROP CONSTRAINT IF EXISTS "project_skills_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_skills"
ADD CONSTRAINT "project_skills_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_tags" DROP CONSTRAINT IF EXISTS "project_tags_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_tags"
ADD CONSTRAINT "project_tags_project_id_projects_id_fk"
FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_nodes_project_path_idx"
ON "project_nodes" USING btree ("project_id", "path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_nodes_project_parent_updated_idx"
ON "project_nodes" USING btree ("project_id", "parent_id", "updated_at");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT
        "project_id",
        COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid) AS "parent_key",
        LOWER("name") AS "name_key",
        COUNT(*) AS "duplicate_count"
      FROM "project_nodes"
      WHERE "deleted_at" IS NULL
      GROUP BY 1, 2, 3
      HAVING COUNT(*) > 1
    ) duplicates
  ) THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS "project_nodes_active_parent_name_uidx"
      ON "project_nodes" ("project_id", COALESCE("parent_id", ''00000000-0000-0000-0000-000000000000''::uuid), LOWER("name"))
      WHERE "deleted_at" IS NULL
    ';
  ELSE
    RAISE NOTICE 'Skipping project_nodes_active_parent_name_uidx due to duplicate active names per parent.';
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT
        "project_id",
        "path",
        COUNT(*) AS "duplicate_count"
      FROM "project_nodes"
      WHERE "deleted_at" IS NULL
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    ) duplicates
  ) THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS "project_nodes_active_project_path_uidx"
      ON "project_nodes" ("project_id", "path")
      WHERE "deleted_at" IS NULL
    ';
  ELSE
    RAISE NOTICE 'Skipping project_nodes_active_project_path_uidx due to duplicate active paths.';
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT
        LEAST("requester_id", "addressee_id") AS "user_low",
        GREATEST("requester_id", "addressee_id") AS "user_high",
        COUNT(*) AS "duplicate_count"
      FROM "connections"
      WHERE "status" IN ('pending', 'accepted')
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    ) duplicates
  ) THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS "connections_active_pair_uidx"
      ON "connections" (LEAST("requester_id", "addressee_id"), GREATEST("requester_id", "addressee_id"))
      WHERE "status" IN (''pending'', ''accepted'')
    ';
  ELSE
    RAISE NOTICE 'Skipping connections_active_pair_uidx due to duplicate active connection pairs.';
  END IF;
END $$;
