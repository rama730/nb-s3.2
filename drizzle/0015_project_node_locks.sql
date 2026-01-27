-- Soft locks for multi-user editing

CREATE TABLE IF NOT EXISTS "project_node_locks" (
  "node_id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "locked_by" uuid NOT NULL,
  "acquired_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_locks_node_id_project_nodes_id_fk'
  ) THEN
    ALTER TABLE "project_node_locks"
      ADD CONSTRAINT "project_node_locks_node_id_project_nodes_id_fk"
      FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_locks_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "project_node_locks"
      ADD CONSTRAINT "project_node_locks_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_locks_locked_by_profiles_id_fk'
  ) THEN
    ALTER TABLE "project_node_locks"
      ADD CONSTRAINT "project_node_locks_locked_by_profiles_id_fk"
      FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_node_locks_project_idx" ON "project_node_locks" ("project_id");
CREATE INDEX IF NOT EXISTS "project_node_locks_expires_idx" ON "project_node_locks" ("expires_at");

