ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "connection_privacy" text DEFAULT 'everyone';

UPDATE "profiles"
SET "connection_privacy" = COALESCE("connection_privacy", 'everyone')
WHERE "connection_privacy" IS NULL;

ALTER TABLE "profiles"
ALTER COLUMN "connection_privacy" SET DEFAULT 'everyone';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_connection_privacy_check'
    ) THEN
        ALTER TABLE "profiles"
        ADD CONSTRAINT "profiles_connection_privacy_check"
        CHECK ("connection_privacy" IN ('everyone', 'mutuals_only', 'nobody'));
    END IF;
END $$;

ALTER TABLE "connections"
ADD COLUMN IF NOT EXISTS "blocked_by" uuid,
ADD COLUMN IF NOT EXISTS "blocked_at" timestamp with time zone;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'connections_blocked_by_profiles_id_fk'
    ) THEN
        ALTER TABLE "connections"
        DROP CONSTRAINT "connections_blocked_by_profiles_id_fk";
    END IF;
END $$;

ALTER TABLE "connections"
ADD CONSTRAINT "connections_blocked_by_profiles_id_fk"
FOREIGN KEY ("blocked_by") REFERENCES "profiles"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'connections_blocked_status_check'
    ) THEN
        ALTER TABLE "connections"
        ADD CONSTRAINT "connections_blocked_status_check"
        CHECK (("status" <> 'blocked') OR ("blocked_by" IS NOT NULL AND "blocked_at" IS NOT NULL));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "connections_blocked_by_idx"
ON "connections" ("blocked_by", "blocked_at");
