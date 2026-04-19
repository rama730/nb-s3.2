-- ============================================================================
-- Task Panel Overhaul — Wave 1: project_nodes.current_version
--
-- Every file node now carries a `current_version` counter. When a re-upload is
-- accepted via `replaceNodeWithNewVersion`, we INSERT a new row into
-- `file_versions` (version = current_version + 1) and bump this column in the
-- same transaction. The UI shows a "v3" pill when current_version > 1.
--
-- Folders always have current_version = 1 (default); we keep the column
-- uniform rather than null-for-folders to avoid special-casing in queries.
--
-- The backfill below seeds a v1 `file_versions` row for every existing file,
-- so history queries never return empty results for legacy files. content_hash
-- is left NULL — it will be populated lazily on the next upload, or by the
-- one-off `scripts/backfill-file-hashes.ts` job.
-- ============================================================================

ALTER TABLE "project_nodes"
    ADD COLUMN IF NOT EXISTS "current_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint

-- Backfill: seed file_versions rows for every existing, non-deleted file node.
-- Guard with NOT EXISTS so the migration is safely re-runnable.
INSERT INTO "file_versions" (
    "node_id", "version", "s3_key", "size", "mime_type",
    "content_hash", "uploaded_by", "uploaded_at"
)
SELECT
    pn.id,
    1,
    COALESCE(pn.s3_key, ''),
    COALESCE(pn.size, 0),
    COALESCE(pn.mime_type, 'application/octet-stream'),
    NULL,                  -- lazily hashed
    pn.created_by,
    pn.created_at
FROM "project_nodes" pn
WHERE pn.type = 'file'
  AND pn.s3_key IS NOT NULL
  AND pn.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "file_versions" fv WHERE fv.node_id = pn.id
  );
