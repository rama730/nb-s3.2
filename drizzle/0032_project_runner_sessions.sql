CREATE TABLE IF NOT EXISTS "project_run_profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "name" text NOT NULL,
    "command" text NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_run_sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "profile_id" uuid,
    "started_by" uuid,
    "command" text NOT NULL,
    "status" text DEFAULT 'queued' NOT NULL,
    "exit_code" integer,
    "duration_ms" integer,
    "error_count" integer DEFAULT 0 NOT NULL,
    "warning_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_run_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "session_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "stream" text DEFAULT 'stdout' NOT NULL,
    "line_number" integer DEFAULT 0 NOT NULL,
    "message" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_run_diagnostics" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "session_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "node_id" uuid,
    "file_path" text,
    "line" integer,
    "column" integer,
    "severity" text DEFAULT 'error' NOT NULL,
    "source" text,
    "code" text,
    "message" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "project_run_profiles"
 ADD CONSTRAINT "project_run_profiles_project_id_projects_id_fk"
 FOREIGN KEY ("project_id")
 REFERENCES "public"."projects"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_profiles"
 ADD CONSTRAINT "project_run_profiles_created_by_profiles_id_fk"
 FOREIGN KEY ("created_by")
 REFERENCES "public"."profiles"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_sessions"
 ADD CONSTRAINT "project_run_sessions_project_id_projects_id_fk"
 FOREIGN KEY ("project_id")
 REFERENCES "public"."projects"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_sessions"
 ADD CONSTRAINT "project_run_sessions_profile_id_project_run_profiles_id_fk"
 FOREIGN KEY ("profile_id")
 REFERENCES "public"."project_run_profiles"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_sessions"
 ADD CONSTRAINT "project_run_sessions_started_by_profiles_id_fk"
 FOREIGN KEY ("started_by")
 REFERENCES "public"."profiles"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_logs"
 ADD CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk"
 FOREIGN KEY ("session_id")
 REFERENCES "public"."project_run_sessions"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_logs"
 ADD CONSTRAINT "project_run_logs_project_id_projects_id_fk"
 FOREIGN KEY ("project_id")
 REFERENCES "public"."projects"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_diagnostics"
 ADD CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk"
 FOREIGN KEY ("session_id")
 REFERENCES "public"."project_run_sessions"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_diagnostics"
 ADD CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk"
 FOREIGN KEY ("project_id")
 REFERENCES "public"."projects"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_run_diagnostics"
 ADD CONSTRAINT "project_run_diagnostics_node_id_project_nodes_id_fk"
 FOREIGN KEY ("node_id")
 REFERENCES "public"."project_nodes"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_run_profiles_project_name_uidx"
 ON "project_run_profiles" USING btree ("project_id","name");
CREATE INDEX IF NOT EXISTS "project_run_profiles_project_idx"
 ON "project_run_profiles" USING btree ("project_id");

CREATE INDEX IF NOT EXISTS "project_run_sessions_project_idx"
 ON "project_run_sessions" USING btree ("project_id","started_at");
CREATE INDEX IF NOT EXISTS "project_run_sessions_profile_idx"
 ON "project_run_sessions" USING btree ("profile_id");
CREATE INDEX IF NOT EXISTS "project_run_sessions_status_idx"
 ON "project_run_sessions" USING btree ("status","started_at");

CREATE INDEX IF NOT EXISTS "project_run_logs_session_idx"
 ON "project_run_logs" USING btree ("session_id","line_number");
CREATE INDEX IF NOT EXISTS "project_run_logs_project_idx"
 ON "project_run_logs" USING btree ("project_id","created_at");

CREATE INDEX IF NOT EXISTS "project_run_diagnostics_session_idx"
 ON "project_run_diagnostics" USING btree ("session_id","severity");
CREATE INDEX IF NOT EXISTS "project_run_diagnostics_project_idx"
 ON "project_run_diagnostics" USING btree ("project_id","created_at");
CREATE INDEX IF NOT EXISTS "project_run_diagnostics_node_idx"
 ON "project_run_diagnostics" USING btree ("node_id");
