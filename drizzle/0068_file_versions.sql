-- ============================================================================
-- Task Panel Overhaul — Wave 1: file_versions table
--
-- Every file row in `project_nodes` gets a sidecar version history. When a user
-- re-uploads an edited copy of a file (detected via filename + SHA-256 content
-- hash), we append a new `file_versions` row instead of creating a sibling with
-- a "-1" / "-2" suffix. Old blobs are retained.
--
-- Invariants
--   • One row per (node_id, version).  version is a monotonically increasing
--     int starting at 1 per node.
--   • s3_key is write-once per row — restoring an older version copies an
--     existing row forward rather than editing in place.
--   • content_hash is lowercase hex SHA-256 of the blob; NULL is allowed for
--     pre-Wave-1 backfilled rows (hashed lazily on next upload).
--   • Deleting the parent node cascades to all its versions.
--
-- Sibling column `project_nodes.current_version` is added in 0069.
-- The realtime publication entry is added in 0071.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "file_versions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "node_id" uuid NOT NULL,
    "version" integer NOT NULL,
    "s3_key" text NOT NULL,
    "size" bigint NOT NULL,
    "mime_type" text NOT NULL,
    "content_hash" text,
    "uploaded_by" uuid,
    "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
    "comment" text
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "file_versions"
    ADD CONSTRAINT "file_versions_node_id_project_nodes_id_fk"
    FOREIGN KEY ("node_id")
    REFERENCES "public"."project_nodes"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "file_versions"
    ADD CONSTRAINT "file_versions_uploaded_by_profiles_id_fk"
    FOREIGN KEY ("uploaded_by")
    REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "file_versions_node_version_unique"
    ON "file_versions" USING btree ("node_id", "version");
--> statement-breakpoint

-- Latest-version lookup: ORDER BY version DESC LIMIT 1 becomes an index scan.
CREATE INDEX IF NOT EXISTS "file_versions_node_version_desc_idx"
    ON "file_versions" USING btree ("node_id", "version" DESC);
--> statement-breakpoint

-- Dedup on re-upload: "does any version of this node already have this hash?"
CREATE INDEX IF NOT EXISTS "file_versions_content_hash_idx"
    ON "file_versions" USING btree ("content_hash");
--> statement-breakpoint

-- ============================================================================
-- Row-Level Security
--
-- Viewers who can read the parent project_node can read its version history.
-- Mirrors the project_nodes_read policy from 0063: owner OR non-deleted member
-- OR (public project AND not soft-deleted).
--
-- INSERTs are expected to go through the `replaceNodeWithNewVersion` server
-- action which uses the service role, so the insert policy matches the
-- "project members with non-viewer role" pattern from project_nodes_write.
-- No UPDATE / DELETE — history is append-only; soft delete cascades via node.
-- ============================================================================
ALTER TABLE "file_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "file_versions_read" ON "file_versions";
CREATE POLICY "file_versions_read"
ON "file_versions" FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "project_nodes" pn
    JOIN "projects" p ON pn.project_id = p.id
    WHERE pn.id = file_versions.node_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM "project_members" m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "file_versions_public_read" ON "file_versions";
CREATE POLICY "file_versions_public_read"
ON "file_versions" FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "project_nodes" pn
    JOIN "projects" p ON pn.project_id = p.id
    WHERE pn.id = file_versions.node_id
      AND p.visibility = 'public'
      AND pn.deleted_at IS NULL
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "file_versions_write" ON "file_versions";
CREATE POLICY "file_versions_write"
ON "file_versions" FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "project_nodes" pn
    JOIN "projects" p ON pn.project_id = p.id
    WHERE pn.id = file_versions.node_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM "project_members" m
          WHERE m.project_id = p.id
            AND m.user_id = auth.uid()
            AND m.role <> 'viewer'
        )
      )
  )
);
--> statement-breakpoint

-- No UPDATE or DELETE policies — file_versions is append-only.
