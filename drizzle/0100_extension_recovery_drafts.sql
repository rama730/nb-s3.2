CREATE TABLE IF NOT EXISTS "extension_recovery_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "node_id" uuid REFERENCES "project_nodes"("id") ON DELETE SET NULL,
  "device_id" text NOT NULL,
  "session_id" text NOT NULL,
  "file_path" text NOT NULL,
  "storage_key" text NOT NULL UNIQUE,
  "size" bigint NOT NULL,
  "mime_type" text NOT NULL DEFAULT 'text/plain',
  "content_hash" text NOT NULL,
  "base_version" integer,
  "base_hash" text,
  "task_context" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "failure_reason" text,
  "captured_at" timestamp with time zone NOT NULL,
  "finalized_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "extension_recovery_drafts_status_check"
    CHECK ("status" IN ('pending', 'finalized', 'failed', 'expired')),
  CONSTRAINT "extension_recovery_drafts_size_check"
    CHECK ("size" >= 0 AND "size" <= 10485760),
  CONSTRAINT "extension_recovery_drafts_hash_check"
    CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "extension_recovery_drafts_base_hash_check"
    CHECK ("base_hash" IS NULL OR "base_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "extension_recovery_drafts_owner_updated_idx"
  ON "extension_recovery_drafts" ("user_id", "updated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_drafts_project_path_idx"
  ON "extension_recovery_drafts" ("project_id", "file_path", "updated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_drafts_device_file_idx"
  ON "extension_recovery_drafts" ("user_id", "device_id", "project_id", "file_path", "captured_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_drafts_expiry_idx"
  ON "extension_recovery_drafts" ("status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_drafts_node_idx"
  ON "extension_recovery_drafts" ("node_id");
--> statement-breakpoint

ALTER TABLE "extension_recovery_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "extension_recovery_drafts_owner_select" ON "extension_recovery_drafts";
CREATE POLICY "extension_recovery_drafts_owner_select"
  ON "extension_recovery_drafts" FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "extension_recovery_drafts_owner_insert" ON "extension_recovery_drafts";
CREATE POLICY "extension_recovery_drafts_owner_insert"
  ON "extension_recovery_drafts" FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "extension_recovery_drafts_owner_update" ON "extension_recovery_drafts";
CREATE POLICY "extension_recovery_drafts_owner_update"
  ON "extension_recovery_drafts" FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "extension_recovery_drafts_owner_delete" ON "extension_recovery_drafts";
CREATE POLICY "extension_recovery_drafts_owner_delete"
  ON "extension_recovery_drafts" FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('extension-recovery-drafts', 'extension-recovery-drafts', false, 10485760, ARRAY['text/plain', 'application/json', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['text/plain', 'application/json', 'application/octet-stream'];
