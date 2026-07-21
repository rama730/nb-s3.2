CREATE TABLE IF NOT EXISTS "extension_recovery_sessions" (
  "session_id" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "extension_version" text,
  "started_at" timestamp with time zone NOT NULL,
  "last_heartbeat_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "incident_detected_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "extension_recovery_sessions_status_check"
    CHECK ("status" IN ('active', 'clean', 'interrupted', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_sessions_owner_status_heartbeat_idx"
  ON "extension_recovery_sessions" ("user_id", "status", "last_heartbeat_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_sessions_owner_device_idx"
  ON "extension_recovery_sessions" ("user_id", "device_id", "started_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extension_recovery_sessions_updated_idx"
  ON "extension_recovery_sessions" ("updated_at");
--> statement-breakpoint
ALTER TABLE "extension_recovery_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE "extension_recovery_sessions" FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "extension_recovery_sessions" FROM anon;
