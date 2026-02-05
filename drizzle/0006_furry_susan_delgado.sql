CREATE TABLE "role_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "project_nodes_folder_content_idx";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "current_task_number" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "task_number" integer;--> statement-breakpoint
ALTER TABLE "role_applications" ADD CONSTRAINT "role_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_applications" ADD CONSTRAINT "role_applications_role_id_project_open_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."project_open_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_applications" ADD CONSTRAINT "role_applications_applicant_id_profiles_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_applications_applicant_idx" ON "role_applications" USING btree ("applicant_id","status");--> statement-breakpoint
CREATE INDEX "role_applications_creator_pending_idx" ON "role_applications" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "role_applications_cooldown_idx" ON "role_applications" USING btree ("project_id","applicant_id","updated_at");--> statement-breakpoint
CREATE INDEX "role_applications_unique_idx" ON "role_applications" USING btree ("project_id","applicant_id");--> statement-breakpoint
CREATE INDEX "task_subtasks_task_idx" ON "task_subtasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "messages_content_search_idx" ON "messages" USING gin (to_tsvector('english', coalesce("content", '')));--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "profiles_skills_idx" ON "profiles" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "profiles_interests_idx" ON "profiles" USING gin ("interests");--> statement-breakpoint
CREATE INDEX "profiles_created_at_idx" ON "profiles" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "profiles_username_search_idx" ON "profiles" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "profiles_full_name_search_idx" ON "profiles" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_file_index_content_search_idx" ON "project_file_index" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_nodes_listing_idx" ON "project_nodes" USING btree ("project_id","parent_id","type","name");--> statement-breakpoint
CREATE INDEX "projects_key_idx" ON "projects" USING btree ("key");--> statement-breakpoint
CREATE INDEX "projects_title_search_idx" ON "projects" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_description_search_idx" ON "projects" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_title_search_idx" ON "tasks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_creator_idx" ON "tasks" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "tasks_project_number_idx" ON "tasks" USING btree ("project_id","task_number");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_key_unique" UNIQUE("key");