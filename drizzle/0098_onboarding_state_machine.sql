ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "onboarding_status" text NOT NULL DEFAULT 'not_started',
ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "onboarding_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint

ALTER TABLE "onboarding_drafts"
ADD COLUMN IF NOT EXISTS "completed_through" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "active_section" text NOT NULL DEFAULT 'identity',
ADD COLUMN IF NOT EXISTS "schema_version" integer NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "onboarding_drafts"
SET
  "completed_through" = GREATEST(0, LEAST(4, "step" - 1)),
  "schema_version" = 3,
  "expires_at" = COALESCE("expires_at", "updated_at" + interval '30 days');
--> statement-breakpoint

ALTER TABLE "onboarding_drafts"
ALTER COLUMN "expires_at" SET DEFAULT (now() + interval '30 days'),
ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint

UPDATE "profiles" AS p
SET
  "onboarding_status" = CASE
    WHEN p."username" IS NOT NULL AND length(trim(p."username")) > 0 THEN 'completed'
    WHEN EXISTS (SELECT 1 FROM "onboarding_drafts" d WHERE d."user_id" = p."id") THEN 'in_progress'
    ELSE 'not_started'
  END,
  "onboarding_completed_at" = CASE
    WHEN p."username" IS NOT NULL AND length(trim(p."username")) > 0
      THEN COALESCE(p."onboarding_completed_at", p."updated_at", now())
    ELSE NULL
  END;
--> statement-breakpoint

ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_onboarding_status_check";
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_onboarding_status_check"
CHECK ("onboarding_status" IN ('not_started', 'in_progress', 'completed'));
--> statement-breakpoint

ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_onboarding_version_check";
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_onboarding_version_check"
CHECK ("onboarding_version" > 0);
--> statement-breakpoint

ALTER TABLE "onboarding_drafts" DROP CONSTRAINT IF EXISTS "onboarding_drafts_completed_through_check";
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_completed_through_check"
CHECK ("completed_through" BETWEEN 0 AND 4);
--> statement-breakpoint

ALTER TABLE "onboarding_drafts" DROP CONSTRAINT IF EXISTS "onboarding_drafts_active_section_check";
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_active_section_check"
CHECK ("active_section" IN ('identity', 'work', 'profile', 'social'));
--> statement-breakpoint

ALTER TABLE "onboarding_drafts" DROP CONSTRAINT IF EXISTS "onboarding_drafts_schema_version_check";
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_schema_version_check"
CHECK ("schema_version" > 0);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "profiles_onboarding_status_idx"
ON "profiles" ("onboarding_status", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "onboarding_drafts_expires_at_idx"
ON "onboarding_drafts" ("expires_at")
WHERE "expires_at" IS NOT NULL;
--> statement-breakpoint

GRANT SELECT ("onboarding_status") ON TABLE "profiles" TO authenticated;
