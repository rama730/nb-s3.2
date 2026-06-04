CREATE INDEX IF NOT EXISTS "projects_public_feed_newest_active_idx"
  ON "projects" USING btree ("visibility", "status", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "projects_public_feed_most_viewed_active_idx"
  ON "projects" USING btree ("visibility", "status", "view_count" DESC, "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "projects_public_feed_most_followed_active_idx"
  ON "projects" USING btree ("visibility", "status", "followers_count" DESC, "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "connection_suggestions_user_score_keyset_idx"
  ON "connection_suggestions" USING btree ("user_id", "score" DESC, "suggested_user_id" DESC);

CREATE INDEX IF NOT EXISTS "messages_structured_title_trgm_idx"
  ON "messages" USING gin ((coalesce("metadata" #>> '{structured,title}', '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "messages_structured_summary_trgm_idx"
  ON "messages" USING gin ((coalesce("metadata" #>> '{structured,summary}', '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "messages_structured_kind_idx"
  ON "messages" USING btree ((coalesce("metadata" #>> '{structured,kind}', '')));

CREATE INDEX IF NOT EXISTS "tasks_project_updated_idx"
  ON "tasks" USING btree ("project_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "project_sprints_project_updated_idx"
  ON "project_sprints" USING btree ("project_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "project_nodes_project_updated_idx"
  ON "project_nodes" USING btree ("project_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "project_open_roles_project_updated_idx"
  ON "project_open_roles" USING btree ("project_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "role_applications_project_updated_idx"
  ON "role_applications" USING btree ("project_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "message_workflow_items_project_updated_idx"
  ON "message_workflow_items" USING btree ("project_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "message_work_links_project_active_updated_idx"
  ON "message_work_links" USING btree ("target_project_id", "updated_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "task_comments_task_created_active_idx"
  ON "task_comments" USING btree ("task_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "file_versions_node_uploaded_at_idx"
  ON "file_versions" USING btree ("node_id", "uploaded_at" DESC);

CREATE INDEX IF NOT EXISTS "task_node_links_task_linked_at_idx"
  ON "task_node_links" USING btree ("task_id", "linked_at" DESC);

CREATE INDEX IF NOT EXISTS "project_nodes_project_path_idx"
  ON "project_nodes" USING btree ("project_id", "path");

DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS "project_nodes_active_parent_name_uidx"
      ON "project_nodes" ("project_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), LOWER("name"))
      WHERE "deleted_at" IS NULL;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Skipping project_nodes_active_parent_name_uidx due to duplicate active names per parent.';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS "project_nodes_active_project_path_uidx"
      ON "project_nodes" ("project_id", "path")
      WHERE "deleted_at" IS NULL;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Skipping project_nodes_active_project_path_uidx due to duplicate active paths.';
  END;
END $$;
