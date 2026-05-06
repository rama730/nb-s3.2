-- ============================================================================
-- Realtime Notification Inbox
--
-- The application bell is backed by one durable, low-noise inbox table. Source
-- domains write canonical rows here, and the header tray subscribes to
-- this table directly instead of rebuilding notifications from source tables.
-- ============================================================================

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb DEFAULT '{
    "messages": true,
    "mentions": true,
    "workflows": true,
    "projects": true,
    "tasks": true,
    "applications": true,
    "connections": true,
    "pausedUntil": null,
    "mutedScopes": []
  }'::jsonb;
--> statement-breakpoint

UPDATE "profiles"
SET "notification_preferences" = '{
  "messages": true,
  "mentions": true,
  "workflows": true,
  "projects": true,
  "tasks": true,
  "applications": true,
  "connections": true,
  "pausedUntil": null,
  "mutedScopes": []
}'::jsonb
WHERE "notification_preferences" IS NULL;
--> statement-breakpoint

UPDATE "profiles"
SET "notification_preferences" =
  jsonb_set(
    jsonb_set("notification_preferences", '{pausedUntil}', COALESCE("notification_preferences"->'pausedUntil', 'null'::jsonb), true),
    '{mutedScopes}',
    COALESCE("notification_preferences"->'mutedScopes', '[]'::jsonb),
    true
  )
WHERE "notification_preferences" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "kind" text NOT NULL,
  "importance" text DEFAULT 'more' NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "entity_refs" jsonb DEFAULT null,
  "preview" jsonb DEFAULT null,
  "dedupe_key" text NOT NULL,
  "aggregate_count" integer DEFAULT 1 NOT NULL,
  "read_at" timestamp with time zone,
  "seen_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_notifications_importance_check"
    CHECK ("importance" IN ('important', 'more')),
  CONSTRAINT "user_notifications_aggregate_count_check"
    CHECK ("aggregate_count" >= 1)
);
--> statement-breakpoint

ALTER TABLE "user_notifications"
  ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp with time zone;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "user_notifications"
    ADD CONSTRAINT "user_notifications_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "user_notifications"
    ADD CONSTRAINT "user_notifications_actor_user_id_profiles_id_fk"
    FOREIGN KEY ("actor_user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_user_created_idx"
  ON "user_notifications" USING btree ("user_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_user_updated_idx"
  ON "user_notifications" USING btree ("user_id", "updated_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_user_read_idx"
  ON "user_notifications" USING btree ("user_id", "read_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_user_dismissed_idx"
  ON "user_notifications" USING btree ("user_id", "dismissed_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_notifications_user_dedupe_unique"
  ON "user_notifications" USING btree ("user_id", "dedupe_key");
--> statement-breakpoint

-- ============================================================================
-- Row-Level Security
--
-- The server notification service writes rows through privileged database
-- access. Browser clients may only read their own inbox rows; mutations go
-- through server actions so arbitrary columns cannot be updated from the UI.
-- ============================================================================
ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "user_notifications_read_own" ON "user_notifications";
CREATE POLICY "user_notifications_read_own"
ON "user_notifications" FOR SELECT
USING ("user_id" = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "user_notifications_update_own" ON "user_notifications";
--> statement-breakpoint

-- Realtime is the source of truth for the bell/feed. This is idempotent so
-- local, preview, and production databases can re-run safely.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "user_notifications";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ============================================================================
-- Notification snooze / delayed delivery
-- ============================================================================
ALTER TABLE "user_notifications"
  ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_user_snoozed_idx"
  ON "user_notifications" ("user_id", "snoozed_until");
--> statement-breakpoint

-- ============================================================================
-- Notification entity cascade — auto-dismiss orphan rows
-- ----------------------------------------------------------------------------
-- Entity references are JSONB pointers to projects/tasks/conversations/etc. When
-- a source row is deleted, the durable inbox row is dismissed instead of
-- hard-deleted so the audit trail remains intact while the tray stays safe.
-- ============================================================================
CREATE OR REPLACE FUNCTION dismiss_orphan_notifications()
RETURNS TRIGGER AS $$
DECLARE
    ref_key TEXT;
    now_ts TIMESTAMPTZ := NOW();
BEGIN
    ref_key := TG_ARGV[0];
    UPDATE user_notifications
    SET
        dismissed_at = now_ts,
        read_at = COALESCE(read_at, now_ts),
        seen_at = COALESCE(seen_at, now_ts),
        updated_at = now_ts
    WHERE dismissed_at IS NULL
      AND entity_refs ->> ref_key = OLD.id::text;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_project ON projects;
CREATE TRIGGER user_notifications_cascade_project
    AFTER DELETE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('projectId');
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_task ON tasks;
CREATE TRIGGER user_notifications_cascade_task
    AFTER DELETE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('taskId');
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_conversation ON conversations;
CREATE TRIGGER user_notifications_cascade_conversation
    AFTER DELETE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('conversationId');
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_task_comment ON task_comments;
CREATE TRIGGER user_notifications_cascade_task_comment
    AFTER DELETE ON task_comments
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('commentId');
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_file ON project_nodes;
CREATE TRIGGER user_notifications_cascade_file
    AFTER DELETE ON project_nodes
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('fileId');
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_connection ON connections;
CREATE TRIGGER user_notifications_cascade_connection
    AFTER DELETE ON connections
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('connectionId');
--> statement-breakpoint

DROP TRIGGER IF EXISTS user_notifications_cascade_application ON role_applications;
CREATE TRIGGER user_notifications_cascade_application
    AFTER DELETE ON role_applications
    FOR EACH ROW
    EXECUTE FUNCTION dismiss_orphan_notifications('applicationId');
--> statement-breakpoint

-- ============================================================================
-- Align historical importance with the J1/J2 notification classifier.
-- ============================================================================
UPDATE user_notifications
SET importance = 'more',
    updated_at = NOW()
WHERE importance = 'important'
  AND kind IN (
    'message_burst',
    'workflow_resolved',
    'application_received',
    'application_decision',
    'task_status_attention',
    'task_comment_reply'
  );
--> statement-breakpoint

-- ============================================================================
-- Web push subscriptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_unique"
  ON "push_subscriptions" ("endpoint");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" ("user_id");
--> statement-breakpoint

-- ============================================================================
-- Notification retention + hot-path indexes
-- ============================================================================
DROP INDEX IF EXISTS "user_notifications_user_created_idx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_tray_visible_idx"
  ON "user_notifications" ("user_id", "updated_at" DESC)
  WHERE "dismissed_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_unread_idx"
  ON "user_notifications" ("user_id", "importance")
  WHERE "read_at" IS NULL AND "dismissed_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_dismissed_age_idx"
  ON "user_notifications" ("dismissed_at")
  WHERE "dismissed_at" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_read_age_idx"
  ON "user_notifications" ("read_at")
  WHERE "read_at" IS NOT NULL AND "dismissed_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "push_subscriptions_stale_idx"
  ON "push_subscriptions" ("last_seen_at");
--> statement-breakpoint

-- ============================================================================
-- Notification deliveries: per-channel attempt log
-- ============================================================================
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid,
  "user_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL,
  "error_code" text,
  "error_message" text,
  "attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_notification_id_user_notifications_id_fk"
    FOREIGN KEY ("notification_id") REFERENCES "user_notifications"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_status_time_idx"
  ON "notification_deliveries" ("channel", "status", "attempted_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_deliveries_user_time_idx"
  ON "notification_deliveries" ("user_id", "attempted_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_idx"
  ON "notification_deliveries" ("notification_id")
  WHERE "notification_id" IS NOT NULL;
--> statement-breakpoint

-- ============================================================================
-- Job heartbeats for recurring notification maintenance workers
-- ============================================================================
CREATE TABLE IF NOT EXISTS "job_heartbeats" (
  "job_id" text PRIMARY KEY,
  "last_success_at" timestamp with time zone NOT NULL,
  "last_payload" jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
