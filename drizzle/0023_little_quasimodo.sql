CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interests_name_unique" UNIQUE("name"),
	CONSTRAINT "interests_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profile_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name"),
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "project_node_events" DROP CONSTRAINT "project_node_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_nodes" DROP CONSTRAINT "project_nodes_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" DROP CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_logs" DROP CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_logs" DROP CONSTRAINT "project_run_logs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_profiles" DROP CONSTRAINT "project_run_profiles_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_run_sessions" DROP CONSTRAINT "project_run_sessions_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD COLUMN "path" text DEFAULT '/' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interests_name_search_idx" ON "interests" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "profile_interests_unique_idx" ON "profile_interests" USING btree ("profile_id","interest_id");--> statement-breakpoint
CREATE INDEX "profile_interests_interest_idx" ON "profile_interests" USING btree ("interest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_skills_unique_idx" ON "profile_skills" USING btree ("profile_id","skill_id");--> statement-breakpoint
CREATE INDEX "profile_skills_skill_idx" ON "profile_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_skills_unique_idx" ON "project_skills" USING btree ("project_id","skill_id");--> statement-breakpoint
CREATE INDEX "project_skills_skill_idx" ON "project_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_tags_unique_idx" ON "project_tags" USING btree ("project_id","tag_id");--> statement-breakpoint
CREATE INDEX "project_tags_tag_idx" ON "project_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "skills_name_search_idx" ON "skills" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_search_idx" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "project_node_events" ADD CONSTRAINT "project_node_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_logs" ADD CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_logs" ADD CONSTRAINT "project_run_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_profiles" ADD CONSTRAINT "project_run_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_sessions" ADD CONSTRAINT "project_run_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_nodes_path_idx" ON "project_nodes" USING btree ("path");