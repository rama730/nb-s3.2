-- ============================================================================
-- Task Panel Overhaul — Wave 1: realtime publication extensions
--
-- Add `file_versions` and `comment_mentions` to the `supabase_realtime`
-- publication so the Files tab can live-render "v3" pills the instant a peer
-- uploads a new version, and the Comments tab can live-highlight a mention.
--
-- Both ALTER statements are wrapped in DO blocks so the migration is
-- idempotent (no-op if the table is already in the publication).
-- ============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "file_versions";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "comment_mentions";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
