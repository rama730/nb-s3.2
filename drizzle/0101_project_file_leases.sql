CREATE SEQUENCE IF NOT EXISTS "project_node_lock_fencing_seq" AS bigint;
--> statement-breakpoint

DELETE FROM "project_node_locks"
WHERE "expires_at" <= now();
--> statement-breakpoint

ALTER TABLE "project_node_locks"
  ADD COLUMN IF NOT EXISTS "lease_id" uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "client_kind" text DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS "device_session_id" uuid,
  ADD COLUMN IF NOT EXISTS "fencing_token" bigint,
  ADD COLUMN IF NOT EXISTS "renewed_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint

UPDATE "project_node_locks"
SET
  "session_id" = COALESCE("session_id", gen_random_uuid()),
  "lease_id" = COALESCE("lease_id", gen_random_uuid()),
  "client_kind" = COALESCE("client_kind", 'web'),
  "fencing_token" = COALESCE("fencing_token", nextval('project_node_lock_fencing_seq')),
  "renewed_at" = COALESCE("renewed_at", "acquired_at", now());
--> statement-breakpoint

ALTER TABLE "project_node_locks"
  ALTER COLUMN "session_id" SET NOT NULL,
  ALTER COLUMN "lease_id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "lease_id" SET NOT NULL,
  ALTER COLUMN "client_kind" SET DEFAULT 'web',
  ALTER COLUMN "client_kind" SET NOT NULL,
  ALTER COLUMN "fencing_token" SET DEFAULT nextval('project_node_lock_fencing_seq'),
  ALTER COLUMN "fencing_token" SET NOT NULL,
  ALTER COLUMN "renewed_at" SET DEFAULT now(),
  ALTER COLUMN "renewed_at" SET NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_locks_client_kind_check'
  ) THEN
    ALTER TABLE "project_node_locks"
      ADD CONSTRAINT "project_node_locks_client_kind_check"
      CHECK ("client_kind" IN ('web', 'vscode'));
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_node_locks_device_session_fk'
  ) THEN
    ALTER TABLE "project_node_locks"
      ADD CONSTRAINT "project_node_locks_device_session_fk"
      FOREIGN KEY ("device_session_id") REFERENCES "extension_device_sessions"("id")
      ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_node_locks_lease_uidx"
  ON "project_node_locks" ("lease_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_node_locks_project_expires_idx"
  ON "project_node_locks" ("project_id", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_node_locks_owner_session_idx"
  ON "project_node_locks" ("locked_by", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_node_locks_device_session_idx"
  ON "project_node_locks" ("device_session_id")
  WHERE "device_session_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "project_node_locks" REPLICA IDENTITY FULL;
--> statement-breakpoint

DROP POLICY IF EXISTS "project_node_locks_write" ON "project_node_locks";
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "project_node_locks" FROM authenticated;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'project_node_locks'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "project_node_locks";
  END IF;
END $$;
