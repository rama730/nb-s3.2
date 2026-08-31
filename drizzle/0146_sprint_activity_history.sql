ALTER TABLE "task_activity_events"
    ADD COLUMN IF NOT EXISTS "sprint_id" uuid REFERENCES "project_sprints"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Legacy rows predate durable sprint attribution. Backfill their current sprint
-- once; new writes always store the sprint at the time of the action.
UPDATE "task_activity_events" AS event
SET "sprint_id" = task."sprint_id"
FROM "tasks" AS task
WHERE event."task_id" = task."id"
  AND event."sprint_id" IS NULL
  AND task."sprint_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activity_events_sprint_created_idx"
    ON "task_activity_events" ("project_id", "sprint_id", "created_at", "id");
