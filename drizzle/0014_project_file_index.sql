-- Project file content index (for Find in Project)
-- Stores text content for searchable files (synced on save).

CREATE TABLE IF NOT EXISTS "project_file_index" (
  "node_id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_file_index_node_id_project_nodes_id_fk'
  ) THEN
    ALTER TABLE "project_file_index"
      ADD CONSTRAINT "project_file_index_node_id_project_nodes_id_fk"
      FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_file_index_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "project_file_index"
      ADD CONSTRAINT "project_file_index_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_file_index_project_idx" ON "project_file_index" ("project_id");

-- Full-text search index (simple config)
CREATE INDEX IF NOT EXISTS "project_file_index_content_fts_idx"
  ON "project_file_index"
  USING GIN (to_tsvector('simple', "content"));

