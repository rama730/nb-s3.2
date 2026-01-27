CREATE TABLE "project_file_index" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_node_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" uuid,
	"actor_id" uuid,
	"type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_node_locks" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"locked_by" uuid NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"file_name" text NOT NULL,
	"custom_name" text,
	"file_path" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_type" text,
	"description" text,
	"category" text DEFAULT 'general',
	"tags" jsonb DEFAULT '[]'::jsonb,
	"uploaded_by" uuid,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_node_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "project_nodes" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_file_index" ADD CONSTRAINT "project_file_index_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_file_index" ADD CONSTRAINT "project_file_index_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_events" ADD CONSTRAINT "project_node_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_events" ADD CONSTRAINT "project_node_events_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_events" ADD CONSTRAINT "project_node_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_locks" ADD CONSTRAINT "project_node_locks_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_locks" ADD CONSTRAINT "project_node_locks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_node_locks" ADD CONSTRAINT "project_node_locks_locked_by_profiles_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_node_links" ADD CONSTRAINT "task_node_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_node_links" ADD CONSTRAINT "task_node_links_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_node_links" ADD CONSTRAINT "task_node_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_file_index_project_idx" ON "project_file_index" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_node_events_project_idx" ON "project_node_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_node_events_node_idx" ON "project_node_events" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "project_node_locks_project_idx" ON "project_node_locks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_node_locks_expires_idx" ON "project_node_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "task_files_task_idx" ON "task_files" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_task_files_category" ON "task_files" USING btree ("category");--> statement-breakpoint
CREATE INDEX "task_node_links_task_idx" ON "task_node_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_node_links_node_idx" ON "task_node_links" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "task_node_links_unique_idx" ON "task_node_links" USING btree ("task_id","node_id");--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_deleted_by_profiles_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;