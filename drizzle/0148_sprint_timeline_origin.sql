ALTER TABLE "tasks"
    ADD COLUMN IF NOT EXISTS "timeline_origin_sprint_id" uuid REFERENCES "project_sprints"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "timeline_origin_at" timestamp with time zone;
--> statement-breakpoint
-- Existing work keeps the Sprint it belongs to at adoption time. New writes
-- set these values atomically when work first enters a Sprint.
UPDATE "tasks"
SET
    "timeline_origin_sprint_id" = "sprint_id",
    "timeline_origin_at" = "created_at"
WHERE "timeline_origin_sprint_id" IS NULL
  AND "sprint_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_timeline_origin_sprint_idx"
    ON "tasks" ("timeline_origin_sprint_id", "timeline_origin_at", "id");
