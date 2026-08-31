ALTER TABLE "task_node_links" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
