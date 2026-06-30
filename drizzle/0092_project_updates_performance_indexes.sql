-- drizzle-pg-migration-non-transactional

-- 0. Drop any failed remnants
DROP INDEX CONCURRENTLY IF EXISTS project_updates_covering_feed_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS project_update_comments_active_parent_idx;
--> statement-breakpoint

-- 1. Create the new indexes concurrently
CREATE INDEX CONCURRENTLY IF NOT EXISTS project_updates_covering_feed_idx
ON project_updates (project_id, visibility, is_pinned, created_at DESC)
INCLUDE (id, author_id, content, update_type, like_count, comment_count);
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS project_update_comments_active_parent_idx
ON project_update_comments (update_id, parent_id, created_at DESC)
WHERE deleted_at IS NULL;
