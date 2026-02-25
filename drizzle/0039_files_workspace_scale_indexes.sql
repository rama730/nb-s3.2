CREATE INDEX IF NOT EXISTS project_nodes_active_name_lookup_idx
ON project_nodes (project_id, parent_id, lower(name))
WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_node_locks_project_node_expires_idx
ON project_node_locks (project_id, node_id, expires_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_nodes_project_deleted_updated_idx
ON project_nodes (project_id, deleted_at, updated_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS connections_requester_addressee_status_idx
ON connections (requester_id, addressee_id, status);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS connections_pending_created_idx
ON connections (requester_id, created_at DESC)
WHERE status = 'pending';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS messages_conversation_active_created_idx
ON messages (conversation_id, created_at DESC)
WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS conv_participants_user_unread_idx
ON conversation_participants (user_id, unread_count);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS tasks_project_status_priority_due_idx
ON tasks (project_id, status, priority, due_date);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS tasks_assignee_status_due_idx
ON tasks (assignee_id, status, due_date);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS projects_owner_status_created_idx
ON projects (owner_id, status, created_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS projects_tags_gin_idx ON projects USING GIN (tags);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS projects_skills_gin_idx ON projects USING GIN (skills);
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_node_events_project_type
ON project_node_events (project_id, type, created_at DESC);
--> statement-breakpoint
