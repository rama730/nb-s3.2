-- drizzle-pg-migration-non-transactional
-- Canonical follow-up for schema lineage and foreign-key maintenance paths.
-- Every statement is idempotent because this migration intentionally runs
-- outside a transaction to allow CREATE INDEX CONCURRENTLY.

ALTER TABLE "project_update_comments"
  DROP CONSTRAINT IF EXISTS "project_update_comments_target_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "message_reactions"
  DROP CONSTRAINT IF EXISTS "message_reactions_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors"
  DROP CONSTRAINT IF EXISTS "project_readme_draft_contributors_project_id_fkey";
--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors"
  DROP CONSTRAINT IF EXISTS "project_readme_draft_contributors_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "project_node_events"
  DROP CONSTRAINT IF EXISTS "project_node_events_project_id_fkey";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics"
  DROP CONSTRAINT IF EXISTS "project_run_diagnostics_project_id_fkey";
--> statement-breakpoint
ALTER TABLE "project_run_logs"
  DROP CONSTRAINT IF EXISTS "project_run_logs_project_id_fkey";
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS "collections_owner_id_idx"
  ON "collections" ("owner_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "connection_suggestion_dismissals_profile_idx"
  ON "connection_suggestion_dismissals" ("dismissed_profile_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "connection_suggestions_suggested_user_idx"
  ON "connection_suggestions" ("suggested_user_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "extension_device_session_events_session_idx"
  ON "extension_device_session_events" ("session_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "import_job_files_upload_intent_idx"
  ON "import_job_files" ("upload_intent_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "import_jobs_project_idx"
  ON "import_jobs" ("project_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_delivery_receipts_message_conversation_idx"
  ON "message_delivery_receipts" ("message_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_reactions_message_conversation_idx"
  ON "message_reactions" ("message_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_read_receipts_message_conversation_idx"
  ON "message_read_receipts" ("message_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_reports_message_conversation_idx"
  ON "message_reports" ("message_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_work_links_created_by_idx"
  ON "message_work_links" ("created_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "profile_contribution_stages_project_idx"
  ON "profile_project_contribution_stages" ("project_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "profile_contribution_stages_verified_by_idx"
  ON "profile_project_contribution_stages" ("verified_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "profile_project_contributions_verified_by_idx"
  ON "profile_project_contributions" ("verified_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_git_deltas_file_version_idx"
  ON "project_git_deltas" ("file_version_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_git_deltas_node_idx"
  ON "project_git_deltas" ("node_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_git_deltas_task_idx"
  ON "project_git_deltas" ("task_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_markdown_assets_markdown_idx"
  ON "project_markdown_assets" ("markdown_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_markdowns_draft_updated_by_idx"
  ON "project_markdowns" ("draft_updated_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_markdowns_published_version_idx"
  ON "project_markdowns" ("published_version_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_markdowns_linked_node_idx"
  ON "project_markdowns" ("linked_node_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_node_conflicts_node_idx"
  ON "project_node_conflicts" ("node_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_node_conflicts_project_idx"
  ON "project_node_conflicts" ("project_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_node_conflicts_task_idx"
  ON "project_node_conflicts" ("task_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_nodes_canonical_node_idx"
  ON "project_nodes" ("canonical_node_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_nodes_task_idx"
  ON "project_nodes" ("task_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_sprints_creator_idx"
  ON "project_sprints" ("creator_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_update_comments_deleted_by_idx"
  ON "project_update_comments" ("deleted_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_update_comments_target_user_idx"
  ON "project_update_comments" ("target_user_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_update_drafts_user_idx"
  ON "project_update_drafts" ("user_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_updates_deleted_by_idx"
  ON "project_updates" ("deleted_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "role_applications_proposed_role_idx"
  ON "role_applications" ("proposed_role_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_task_comments_user_id"
  ON "task_comments" ("user_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "task_pushes_project_idx"
  ON "task_pushes" ("project_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "task_pushes_pushed_by_idx"
  ON "task_pushes" ("pushed_by");
