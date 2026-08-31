CREATE TABLE IF NOT EXISTS "task_activity_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "actor_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "event_type" text NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "task_activity_events_task_created_idx"
    ON "task_activity_events" ("task_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "task_activity_events_project_created_idx"
    ON "task_activity_events" ("project_id", "created_at" DESC);
