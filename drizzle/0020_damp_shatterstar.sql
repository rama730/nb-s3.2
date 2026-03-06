CREATE TABLE "attachment_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_upload_id" text NOT NULL,
	"conversation_id" uuid,
	"storage_path" text,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connection_suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dismissed_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_edit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"previous_content" text,
	"next_content" text,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_hidden_for_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_drafts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"step" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"claims_repaired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"previous_value" jsonb DEFAULT 'null'::jsonb,
	"next_value" jsonb DEFAULT 'null'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_run_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" uuid,
	"file_path" text,
	"line" integer,
	"column" integer,
	"severity" text DEFAULT 'error' NOT NULL,
	"source" text,
	"code" text,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_run_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stream" text DEFAULT 'stdout' NOT NULL,
	"line_number" integer DEFAULT 0 NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_run_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_run_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"profile_id" uuid,
	"started_by" uuid,
	"command" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"exit_code" integer,
	"duration_ms" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserved_usernames" (
	"username" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "project_follows_unique_idx";--> statement-breakpoint
DROP INDEX "saved_projects_unique_idx";--> statement-breakpoint
DROP INDEX "task_node_links_unique_idx";--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "last_read_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "unread_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_message_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_message_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "workspace_layout" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "connections_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "projects_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "followers_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_nodes" ADD COLUMN "git_hash" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "followers_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "saves_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_default_branch" text DEFAULT 'main';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_last_commit_sha" text;--> statement-breakpoint
ALTER TABLE "role_applications" ADD COLUMN "accepted_role_title" text;--> statement-breakpoint
ALTER TABLE "role_applications" ADD COLUMN "decision_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "role_applications" ADD COLUMN "decision_by" uuid;--> statement-breakpoint
ALTER TABLE "attachment_uploads" ADD CONSTRAINT "attachment_uploads_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_uploads" ADD CONSTRAINT "attachment_uploads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_suggestion_dismissals" ADD CONSTRAINT "connection_suggestion_dismissals_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_suggestion_dismissals" ADD CONSTRAINT "connection_suggestion_dismissals_dismissed_profile_id_profiles_id_fk" FOREIGN KEY ("dismissed_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_edit_logs" ADD CONSTRAINT "message_edit_logs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_edit_logs" ADD CONSTRAINT "message_edit_logs_editor_id_profiles_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_hidden_for_users" ADD CONSTRAINT "message_hidden_for_users_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_hidden_for_users" ADD CONSTRAINT "message_hidden_for_users_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_submissions" ADD CONSTRAINT "onboarding_submissions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_audit_events" ADD CONSTRAINT "profile_audit_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_diagnostics" ADD CONSTRAINT "project_run_diagnostics_node_id_project_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_logs" ADD CONSTRAINT "project_run_logs_session_id_project_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_run_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_logs" ADD CONSTRAINT "project_run_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_profiles" ADD CONSTRAINT "project_run_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_profiles" ADD CONSTRAINT "project_run_profiles_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_sessions" ADD CONSTRAINT "project_run_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_sessions" ADD CONSTRAINT "project_run_sessions_profile_id_project_run_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."project_run_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_sessions" ADD CONSTRAINT "project_run_sessions_started_by_profiles_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_uploads_user_client_unique" ON "attachment_uploads" USING btree ("user_id","client_upload_id");--> statement-breakpoint
CREATE INDEX "attachment_uploads_user_status_idx" ON "attachment_uploads" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "attachment_uploads_storage_path_idx" ON "attachment_uploads" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "attachment_uploads_conversation_idx" ON "attachment_uploads" USING btree ("conversation_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_suggestion_dismissals_user_profile_uidx" ON "connection_suggestion_dismissals" USING btree ("user_id","dismissed_profile_id");--> statement-breakpoint
CREATE INDEX "connection_suggestion_dismissals_user_created_idx" ON "connection_suggestion_dismissals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "message_edit_logs_message_idx" ON "message_edit_logs" USING btree ("message_id","edited_at");--> statement-breakpoint
CREATE INDEX "message_edit_logs_editor_idx" ON "message_edit_logs" USING btree ("editor_id","edited_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_hidden_for_users_unique" ON "message_hidden_for_users" USING btree ("message_id","user_id");--> statement-breakpoint
CREATE INDEX "message_hidden_for_users_user_idx" ON "message_hidden_for_users" USING btree ("user_id","hidden_at");--> statement-breakpoint
CREATE INDEX "message_hidden_for_users_message_idx" ON "message_hidden_for_users" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "onboarding_drafts_updated_at_idx" ON "onboarding_drafts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "onboarding_events_user_idx" ON "onboarding_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_events_event_idx" ON "onboarding_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_submissions_user_key_uidx" ON "onboarding_submissions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "onboarding_submissions_status_updated_idx" ON "onboarding_submissions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "profile_audit_events_user_event_idx" ON "profile_audit_events" USING btree ("user_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "profile_audit_events_user_created_idx" ON "profile_audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "project_run_diagnostics_session_idx" ON "project_run_diagnostics" USING btree ("session_id","severity");--> statement-breakpoint
CREATE INDEX "project_run_diagnostics_project_idx" ON "project_run_diagnostics" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_run_diagnostics_node_idx" ON "project_run_diagnostics" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "project_run_logs_session_idx" ON "project_run_logs" USING btree ("session_id","line_number");--> statement-breakpoint
CREATE INDEX "project_run_logs_project_idx" ON "project_run_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_run_profiles_project_idx" ON "project_run_profiles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_run_profiles_project_name_uidx" ON "project_run_profiles" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "project_run_sessions_project_idx" ON "project_run_sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "project_run_sessions_profile_idx" ON "project_run_sessions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "project_run_sessions_status_idx" ON "project_run_sessions" USING btree ("status","started_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_applications" ADD CONSTRAINT "role_applications_decision_by_profiles_id_fk" FOREIGN KEY ("decision_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_requester_stats_idx" ON "connections" USING btree ("requester_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "connections_addressee_stats_idx" ON "connections" USING btree ("addressee_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "connections_pending_idx" ON "connections" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "conversation_participants_my_conversations_idx" ON "conversation_participants" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_participants_active_idx" ON "conversation_participants" USING btree ("user_id","archived_at","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_content_trgm_idx" ON "messages" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "messages_sender_created_idx" ON "messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_reply_idx" ON "messages" USING btree ("reply_to_message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_reply_created_idx" ON "messages" USING btree ("conversation_id","reply_to_message_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_sender_client_unique" ON "messages" USING btree ("conversation_id","sender_id","client_message_id");--> statement-breakpoint
CREATE INDEX "profiles_connections_count_idx" ON "profiles" USING btree ("connections_count");--> statement-breakpoint
CREATE INDEX "profiles_projects_count_idx" ON "profiles" USING btree ("projects_count");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_unique" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "projects_feed_newest_idx" ON "projects" USING btree ("visibility","status","created_at");--> statement-breakpoint
CREATE INDEX "projects_feed_most_viewed_idx" ON "projects" USING btree ("visibility","status","view_count");--> statement-breakpoint
CREATE INDEX "projects_my_projects_idx" ON "projects" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "role_applications_accepted_member_idx" ON "role_applications" USING btree ("project_id","applicant_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_follows_unique_idx" ON "project_follows" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_projects_unique_idx" ON "saved_projects" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_node_links_unique_idx" ON "task_node_links" USING btree ("task_id","node_id");