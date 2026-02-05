ALTER TABLE IF EXISTS "task_files" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "task_files" CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_sprint_idx" ON "tasks" USING btree ("project_id","sprint_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_assignee_idx" ON "tasks" USING btree ("project_id","assignee_id");