ALTER TABLE IF EXISTS "project_node_events" DROP CONSTRAINT IF EXISTS "project_node_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_nodes" DROP CONSTRAINT IF EXISTS "project_nodes_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_diagnostics" DROP CONSTRAINT IF EXISTS "project_run_diagnostics_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_diagnostics" DROP CONSTRAINT IF EXISTS "project_run_diagnostics_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_logs" DROP CONSTRAINT IF EXISTS "project_run_logs_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_logs" DROP CONSTRAINT IF EXISTS "project_run_logs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_profiles" DROP CONSTRAINT IF EXISTS "project_run_profiles_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_sessions" DROP CONSTRAINT IF EXISTS "project_run_sessions_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_skills" DROP CONSTRAINT IF EXISTS "project_skills_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "project_tags" DROP CONSTRAINT IF EXISTS "project_tags_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_projects_id_fk";
--> statement-breakpoint
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT conname
    INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'project_node_events'::regclass
      AND contype = 'p';

    IF pk_name IS NOT NULL AND pk_name <> 'project_node_events_id_created_at_pk' THEN
        EXECUTE format('ALTER TABLE "project_node_events" DROP CONSTRAINT %I', pk_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'project_node_events'::regclass
          AND conname = 'project_node_events_id_created_at_pk'
          AND contype = 'p'
    ) THEN
        ALTER TABLE "project_node_events"
            ADD CONSTRAINT "project_node_events_id_created_at_pk" PRIMARY KEY("id","created_at");
    END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT conname
    INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'project_run_diagnostics'::regclass
      AND contype = 'p';

    IF pk_name IS NOT NULL AND pk_name <> 'project_run_diagnostics_id_created_at_pk' THEN
        EXECUTE format('ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT %I', pk_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'project_run_diagnostics'::regclass
          AND conname = 'project_run_diagnostics_id_created_at_pk'
          AND contype = 'p'
    ) THEN
        ALTER TABLE "project_run_diagnostics"
            ADD CONSTRAINT "project_run_diagnostics_id_created_at_pk" PRIMARY KEY("id","created_at");
    END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT conname
    INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'project_run_logs'::regclass
      AND contype = 'p';

    IF pk_name IS NOT NULL AND pk_name <> 'project_run_logs_id_created_at_pk' THEN
        EXECUTE format('ALTER TABLE "project_run_logs" DROP CONSTRAINT %I', pk_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'project_run_logs'::regclass
          AND conname = 'project_run_logs_id_created_at_pk'
          AND contype = 'p'
    ) THEN
        ALTER TABLE "project_run_logs"
            ADD CONSTRAINT "project_run_logs_id_created_at_pk" PRIMARY KEY("id","created_at");
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE IF EXISTS "profiles" ADD COLUMN IF NOT EXISTS "experience_level" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "profiles" ADD COLUMN IF NOT EXISTS "hours_per_week" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "profiles" ADD COLUMN IF NOT EXISTS "gender_identity" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "profiles" ADD COLUMN IF NOT EXISTS "pronouns" text;--> statement-breakpoint
ALTER TABLE IF EXISTS "message_attachments" ALTER COLUMN "size_bytes" SET DATA TYPE bigint USING "size_bytes"::bigint;--> statement-breakpoint
ALTER TABLE IF EXISTS "attachment_uploads" ALTER COLUMN "size_bytes" SET DATA TYPE bigint USING "size_bytes"::bigint;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_node_events" DROP CONSTRAINT IF EXISTS "project_node_events_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_node_events" ADD CONSTRAINT "project_node_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_nodes" DROP CONSTRAINT IF EXISTS "project_nodes_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_nodes" ADD CONSTRAINT "project_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_diagnostics" DROP CONSTRAINT IF EXISTS "project_run_diagnostics_session_id_project_run_sessions_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_diagnostics" DROP CONSTRAINT IF EXISTS "project_run_diagnostics_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_logs" DROP CONSTRAINT IF EXISTS "project_run_logs_session_id_project_run_sessions_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_logs" ADD CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_logs" DROP CONSTRAINT IF EXISTS "project_run_logs_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_logs" ADD CONSTRAINT "project_run_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_profiles" DROP CONSTRAINT IF EXISTS "project_run_profiles_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_profiles" ADD CONSTRAINT "project_run_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_sessions" DROP CONSTRAINT IF EXISTS "project_run_sessions_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_run_sessions" ADD CONSTRAINT "project_run_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_skills" DROP CONSTRAINT IF EXISTS "project_skills_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_skills" ADD CONSTRAINT "project_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "project_tags" DROP CONSTRAINT IF EXISTS "project_tags_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "role_applications" DROP CONSTRAINT IF EXISTS "role_applications_creator_id_profiles_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "role_applications" ADD CONSTRAINT "role_applications_creator_id_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE IF EXISTS "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE IF EXISTS "connections" DROP CONSTRAINT IF EXISTS "connections_no_self_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "connections" ADD CONSTRAINT "connections_no_self_check" CHECK ("connections"."requester_id" <> "connections"."addressee_id");--> statement-breakpoint
ALTER TABLE IF EXISTS "project_nodes" DROP CONSTRAINT IF EXISTS "project_nodes_no_self_parent_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_nodes" ADD CONSTRAINT "project_nodes_no_self_parent_check" CHECK ("project_nodes"."parent_id" IS NULL OR "project_nodes"."parent_id" <> "project_nodes"."id");--> statement-breakpoint
ALTER TABLE IF EXISTS "project_open_roles" DROP CONSTRAINT IF EXISTS "project_open_roles_count_non_negative_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_open_roles" ADD CONSTRAINT "project_open_roles_count_non_negative_check" CHECK ("project_open_roles"."count" >= 0);--> statement-breakpoint
ALTER TABLE IF EXISTS "project_open_roles" DROP CONSTRAINT IF EXISTS "project_open_roles_filled_non_negative_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_open_roles" ADD CONSTRAINT "project_open_roles_filled_non_negative_check" CHECK ("project_open_roles"."filled" >= 0);--> statement-breakpoint
ALTER TABLE IF EXISTS "project_open_roles" DROP CONSTRAINT IF EXISTS "project_open_roles_filled_lte_count_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "project_open_roles" ADD CONSTRAINT "project_open_roles_filled_lte_count_check" CHECK ("project_open_roles"."filled" <= "project_open_roles"."count");
