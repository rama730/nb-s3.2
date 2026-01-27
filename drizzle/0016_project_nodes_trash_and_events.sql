-- Trash + audit trail for project files

-- Soft delete fields
ALTER TABLE "project_nodes"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deleted_by" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_nodes_deleted_by_profiles_id_fk'
  ) THEN
    ALTER TABLE "project_nodes"
      ADD CONSTRAINT "project_nodes_deleted_by_profiles_id_fk"
      FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_nodes_deleted_idx" ON "project_nodes" ("project_id", "deleted_at");

-- Audit events
CREATE TABLE IF NOT EXISTS "project_node_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "node_id" uuid,
  "actor_id" uuid,
  "type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_events_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "project_node_events"
      ADD CONSTRAINT "project_node_events_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_events_node_id_project_nodes_id_fk'
  ) THEN
    ALTER TABLE "project_node_events"
      ADD CONSTRAINT "project_node_events_node_id_project_nodes_id_fk"
      FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_events_actor_id_profiles_id_fk'
  ) THEN
    ALTER TABLE "project_node_events"
      ADD CONSTRAINT "project_node_events_actor_id_profiles_id_fk"
      FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_node_events_project_idx" ON "project_node_events" ("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "project_node_events_node_idx" ON "project_node_events" ("node_id", "created_at");

