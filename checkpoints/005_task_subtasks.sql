-- Add task_subtasks table
CREATE TABLE IF NOT EXISTS "task_subtasks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
    "title" text NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add index
CREATE INDEX IF NOT EXISTS "task_subtasks_task_idx" ON "task_subtasks" ("task_id");
