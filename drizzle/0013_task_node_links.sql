-- Create task_node_links table
CREATE TABLE IF NOT EXISTS "task_node_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);

-- Add Foreign Keys
ALTER TABLE "task_node_links" ADD CONSTRAINT "task_node_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "task_node_links" ADD CONSTRAINT "task_node_links_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "task_node_links" ADD CONSTRAINT "task_node_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;

-- Add Indexes
CREATE INDEX IF NOT EXISTS "task_node_links_task_idx" ON "task_node_links" ("task_id");
CREATE INDEX IF NOT EXISTS "task_node_links_node_idx" ON "task_node_links" ("node_id");
CREATE INDEX IF NOT EXISTS "task_node_links_unique_idx" ON "task_node_links" ("task_id", "node_id");
