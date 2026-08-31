CREATE OR REPLACE FUNCTION "seed_project_workflow_columns"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "project_workflow_columns" ("project_id", "status", "title", "accent_class_name", "empty_title", "empty_description", "position", "is_default")
  VALUES
    (NEW.id, 'todo', 'To Do', 'bg-zinc-500', 'Tasks will appear here...', 'Tasks that are ready to start will appear here. Drag and drop your tasks here.', 0, TRUE),
    (NEW.id, 'in_progress', 'In Progress', 'bg-blue-500', 'Tasks will appear here...', 'Items will appear here as soon as they start. Drag and drop your tasks here.', 1, TRUE),
    (NEW.id, 'blocked', 'Blocked', 'bg-rose-500', 'Tasks will appear here...', 'Tasks waiting on blockers will appear here. Drag and drop your tasks here.', 2, TRUE),
    (NEW.id, 'done', 'Done', 'bg-emerald-500', 'Tasks will appear here...', 'Finished work will appear here. Drag and drop your tasks here.', 3, TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "projects_seed_workflow_columns" ON "projects";
CREATE TRIGGER "projects_seed_workflow_columns"
AFTER INSERT ON "projects"
FOR EACH ROW EXECUTE FUNCTION "seed_project_workflow_columns"();
