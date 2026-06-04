DO $$ BEGIN
    CREATE TYPE "public"."status_connection" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'disconnected', 'blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_file" AS ENUM('pending', 'finalized', 'expired', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_job" AS ENUM('processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_notification" AS ENUM('delivered', 'failed', 'dropped');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_project" AS ENUM('draft', 'active', 'completed', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_readme_asset" AS ENUM('draft', 'published', 'orphaned');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_report" AS ENUM('pending', 'reviewed', 'actioned', 'dismissed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_role_app" AS ENUM('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_sprint" AS ENUM('planning', 'active', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_task" AS ENUM('todo', 'in_progress', 'done', 'blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
    CREATE TYPE "public"."status_workflow" AS ENUM('queued', 'running', 'success', 'failed', 'canceled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."account_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"username" text,
	"reason" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hard_delete_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"confirmation_token" text,
	"token_expires_at" timestamp with time zone,
	"cleanup_status" text DEFAULT 'pending' NOT NULL,
	"cleanup_details" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletions_user_idx" ON "public"."account_deletions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletions_hard_delete_idx" ON "public"."account_deletions" USING btree ("hard_delete_at","completed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletions_token_idx" ON "public"."account_deletions" USING btree ("confirmation_token");
--> statement-breakpoint

-- Drop policy and constraint referencing connections.status before altering its type
DROP POLICY IF EXISTS "Profiles are viewable by allowed users" ON public.profiles;
--> statement-breakpoint
ALTER TABLE "public"."connections" DROP CONSTRAINT IF EXISTS "connections_blocked_status_check";
--> statement-breakpoint

-- Alter connections.status
ALTER TABLE "public"."connections" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."connections" ALTER COLUMN "status" TYPE "public"."status_connection" USING "status"::"public"."status_connection";
--> statement-breakpoint
ALTER TABLE "public"."connections" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."status_connection";
--> statement-breakpoint

-- Recreate policy and constraint referencing connections.status
CREATE POLICY "Profiles are viewable by allowed users"
ON public.profiles FOR SELECT
USING (
    public.get_auth_uid() = id
    OR visibility = 'public'
    OR (
        visibility = 'connections'
        AND EXISTS (
            SELECT 1
            FROM public.connections c
            WHERE c.status = 'accepted'
              AND (
                  (c.requester_id = public.get_auth_uid() AND c.addressee_id = public.profiles.id)
                  OR (c.addressee_id = public.get_auth_uid() AND c.requester_id = public.profiles.id)
              )
        )
    )
);
--> statement-breakpoint
ALTER TABLE "public"."connections" ADD CONSTRAINT "connections_blocked_status_check" CHECK (("status"::text <> 'blocked') OR ("blocked_by" IS NOT NULL AND "blocked_at" IS NOT NULL));
--> statement-breakpoint

-- Alter onboarding_submissions.status (and drop text-enum check constraint)
ALTER TABLE "public"."onboarding_submissions" DROP CONSTRAINT IF EXISTS "onboarding_submissions_status_check";
--> statement-breakpoint
ALTER TABLE "public"."onboarding_submissions" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."onboarding_submissions" ALTER COLUMN "status" TYPE "public"."status_job" USING "status"::"public"."status_job";
--> statement-breakpoint
ALTER TABLE "public"."onboarding_submissions" ALTER COLUMN "status" SET DEFAULT 'processing'::"public"."status_job";
--> statement-breakpoint

-- Alter projects.status
ALTER TABLE "public"."projects" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."projects" ALTER COLUMN "status" TYPE "public"."status_project" USING "status"::"public"."status_project";
--> statement-breakpoint
ALTER TABLE "public"."projects" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."status_project";
--> statement-breakpoint

-- Alter role_applications.status
ALTER TABLE "public"."role_applications" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."role_applications" ALTER COLUMN "status" TYPE "public"."status_role_app" USING "status"::"public"."status_role_app";
--> statement-breakpoint
ALTER TABLE "public"."role_applications" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."status_role_app";
--> statement-breakpoint

-- Alter project_sprints.status
ALTER TABLE "public"."project_sprints" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."project_sprints" ALTER COLUMN "status" TYPE "public"."status_sprint" USING "status"::"public"."status_sprint";
--> statement-breakpoint
ALTER TABLE "public"."project_sprints" ALTER COLUMN "status" SET DEFAULT 'planning'::"public"."status_sprint";
--> statement-breakpoint

-- Alter tasks.status
ALTER TABLE "public"."tasks" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."tasks" ALTER COLUMN "status" TYPE "public"."status_task" USING "status"::"public"."status_task";
--> statement-breakpoint
ALTER TABLE "public"."tasks" ALTER COLUMN "status" SET DEFAULT 'todo'::"public"."status_task";
--> statement-breakpoint

-- Alter upload_intents.status
ALTER TABLE "public"."upload_intents" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."upload_intents" ALTER COLUMN "status" TYPE "public"."status_file" USING "status"::"public"."status_file";
--> statement-breakpoint
ALTER TABLE "public"."upload_intents" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."status_file";
--> statement-breakpoint

-- Alter project_run_sessions.status
ALTER TABLE "public"."project_run_sessions" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."project_run_sessions" ALTER COLUMN "status" TYPE "public"."status_workflow" USING "status"::"public"."status_workflow";
--> statement-breakpoint
ALTER TABLE "public"."project_run_sessions" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."status_workflow";
--> statement-breakpoint

-- Alter message_reports.status
ALTER TABLE "public"."message_reports" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."message_reports" ALTER COLUMN "status" TYPE "public"."status_report" USING "status"::"public"."status_report";
--> statement-breakpoint
ALTER TABLE "public"."message_reports" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."status_report";
--> statement-breakpoint

-- Alter notification_deliveries.status
ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "status" TYPE "public"."status_notification" USING "status"::"public"."status_notification";
--> statement-breakpoint

-- Alter project_readme_assets.status
ALTER TABLE "public"."project_readme_assets" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."project_readme_assets" ALTER COLUMN "status" TYPE "public"."status_readme_asset" USING "status"::"public"."status_readme_asset";
--> statement-breakpoint
ALTER TABLE "public"."project_readme_assets" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."status_readme_asset";
--> statement-breakpoint

-- Create Indexes
CREATE INDEX IF NOT EXISTS "projects_owner_deleted_view_count_idx" ON "public"."projects" USING btree ("owner_id", "deleted_at", "view_count");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_applications_role_id_idx" ON "public"."role_applications" USING btree ("role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_applications_decision_by_idx" ON "public"."role_applications" USING btree ("decision_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_deleted_at_partial_idx" ON "public"."tasks" USING btree ("deleted_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_comments_deleted_by" ON "public"."task_comments" USING btree ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notifications_actor_user_id_idx" ON "public"."user_notifications" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_nodes_created_by_idx" ON "public"."project_nodes" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_nodes_deleted_by_idx" ON "public"."project_nodes" USING btree ("deleted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_nodes_deleted_at_partial_idx" ON "public"."project_nodes" USING btree ("deleted_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_versions_uploaded_by_idx" ON "public"."file_versions" USING btree ("uploaded_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_node_links_created_by_idx" ON "public"."task_node_links" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_projects_project_idx" ON "public"."collection_projects" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_deleted_at_partial_idx" ON "public"."messages" USING btree ("deleted_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_workflow_items_project_idx" ON "public"."message_workflow_items" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_workflow_items_task_idx" ON "public"."message_workflow_items" USING btree ("task_id");
--> statement-breakpoint

-- Add unique constraint on messages
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_id_conversation_unique" UNIQUE("id","conversation_id");
--> statement-breakpoint

-- Composite foreign keys & conversation_id alignments
ALTER TABLE "public"."message_reactions" DROP CONSTRAINT IF EXISTS "message_reactions_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."message_reactions" ADD CONSTRAINT "message_reactions_message_conversation_fkey" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."messages"("id","conversation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "public"."message_reports" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint
UPDATE "public"."message_reports" r
SET "conversation_id" = m."conversation_id"
FROM "public"."messages" m
WHERE r."message_id" = m."id" AND r."conversation_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."message_reports" DROP CONSTRAINT IF EXISTS "message_reports_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."message_reports" ADD CONSTRAINT "message_reports_message_conversation_fkey" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."messages"("id","conversation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "public"."message_read_receipts" DROP CONSTRAINT IF EXISTS "message_read_receipts_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."message_read_receipts" DROP CONSTRAINT IF EXISTS "message_read_receipts_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."message_read_receipts" ADD CONSTRAINT "message_read_receipts_message_conversation_fkey" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."messages"("id","conversation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "public"."message_delivery_receipts" DROP CONSTRAINT IF EXISTS "message_delivery_receipts_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."message_delivery_receipts" DROP CONSTRAINT IF EXISTS "message_delivery_receipts_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."message_delivery_receipts" ADD CONSTRAINT "message_delivery_receipts_message_conversation_fkey" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."messages"("id","conversation_id") ON DELETE cascade ON UPDATE no action;
