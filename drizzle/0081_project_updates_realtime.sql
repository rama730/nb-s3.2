-- ============================================================================
-- Phase 4: project_updates and project_update_comments realtime publication
-- ============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "project_updates";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "project_update_comments";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
