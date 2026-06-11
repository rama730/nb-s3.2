-- ============================================================================
-- Phase 4: project_update_drafts table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "project_update_drafts" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"update_type" text,
	"entity_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_update_drafts_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "project_update_drafts" ADD CONSTRAINT "project_update_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "project_update_drafts" ADD CONSTRAINT "project_update_drafts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_update_drafts_updated_at_idx" ON "project_update_drafts" ("updated_at");
