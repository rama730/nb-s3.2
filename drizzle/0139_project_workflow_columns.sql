CREATE TABLE IF NOT EXISTS "project_workflow_columns" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "status" "status_task" NOT NULL,
    "title" text NOT NULL,
    "accent_class_name" text NOT NULL,
    "empty_title" text NOT NULL,
    "empty_description" text NOT NULL,
    "position" integer NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_workflow_columns_project_position_idx" ON "project_workflow_columns" ("project_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "project_workflow_columns_project_default_status_idx" ON "project_workflow_columns" ("project_id", "status") WHERE "is_default" = TRUE;

INSERT INTO "project_workflow_columns" ("project_id", "status", "title", "accent_class_name", "empty_title", "empty_description", "position", "is_default")
SELECT p.id, v.status::"status_task", v.title, v.accent, 'Tasks will appear here...', v.empty_description, v.position, TRUE
FROM "projects" p
CROSS JOIN (VALUES
  ('todo', 'To Do', 'bg-zinc-500', 'Tasks that are ready to start will appear here. Drag and drop your tasks here.', 0),
  ('in_progress', 'In Progress', 'bg-blue-500', 'Items will appear here as soon as they start. Drag and drop your tasks here.', 1),
  ('blocked', 'Blocked', 'bg-rose-500', 'Tasks waiting on blockers will appear here. Drag and drop your tasks here.', 2),
  ('done', 'Done', 'bg-emerald-500', 'Finished work will appear here. Drag and drop your tasks here.', 3)
) AS v(status, title, accent, empty_description, position)
ON CONFLICT DO NOTHING;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "workflow_column_id" uuid REFERENCES "project_workflow_columns"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "tasks_workflow_column_idx" ON "tasks" ("workflow_column_id");

UPDATE "tasks" t
SET "workflow_column_id" = c.id
FROM "project_workflow_columns" c
WHERE c.project_id = t.project_id AND c.status = t.status AND c.is_default = TRUE AND t.workflow_column_id IS NULL;
