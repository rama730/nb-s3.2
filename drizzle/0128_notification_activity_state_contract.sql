-- Notification inbox ordering is based on source activity, not the reader's
-- actions. This keeps automatic read/snooze/dismiss transitions from moving
-- rows around while the user is reviewing the tray.

ALTER TABLE "user_notifications"
  ADD COLUMN IF NOT EXISTS "activity_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "user_notifications"
SET "activity_at" = COALESCE("activity_at", "updated_at", "created_at", now())
WHERE "activity_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "user_notifications"
  ALTER COLUMN "activity_at" SET DEFAULT now(),
  ALTER COLUMN "activity_at" SET NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_user_activity_idx"
  ON "user_notifications" ("user_id", "activity_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_notifications_tray_visible_activity_idx"
  ON "user_notifications" ("user_id", "activity_at" DESC)
  WHERE "dismissed_at" IS NULL;
