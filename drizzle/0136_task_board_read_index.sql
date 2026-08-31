CREATE INDEX IF NOT EXISTS "tasks_active_project_status_position_idx"
    ON "tasks" ("project_id", "status", "position" DESC, "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;
