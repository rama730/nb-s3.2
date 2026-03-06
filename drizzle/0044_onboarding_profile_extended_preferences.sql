ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "experience_level" text;
--> statement-breakpoint
ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "hours_per_week" text;
--> statement-breakpoint
ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "gender_identity" text;
--> statement-breakpoint
ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "pronouns" text;
--> statement-breakpoint

ALTER TABLE "profiles"
DROP CONSTRAINT IF EXISTS "profiles_experience_level_check";
--> statement-breakpoint
ALTER TABLE "profiles"
ADD CONSTRAINT "profiles_experience_level_check"
CHECK (
  "experience_level" IS NULL
  OR "experience_level" IN ('student', 'junior', 'mid', 'senior', 'lead', 'founder')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE "profiles"
DROP CONSTRAINT IF EXISTS "profiles_hours_per_week_check";
--> statement-breakpoint
ALTER TABLE "profiles"
ADD CONSTRAINT "profiles_hours_per_week_check"
CHECK (
  "hours_per_week" IS NULL
  OR "hours_per_week" IN ('lt_5', 'h_5_10', 'h_10_20', 'h_20_40', 'h_40_plus')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE "profiles"
DROP CONSTRAINT IF EXISTS "profiles_gender_identity_check";
--> statement-breakpoint
ALTER TABLE "profiles"
ADD CONSTRAINT "profiles_gender_identity_check"
CHECK (
  "gender_identity" IS NULL
  OR "gender_identity" IN ('male', 'female', 'non_binary', 'prefer_not_to_say', 'other')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE "profiles"
DROP CONSTRAINT IF EXISTS "profiles_pronouns_length_check";
--> statement-breakpoint
ALTER TABLE "profiles"
ADD CONSTRAINT "profiles_pronouns_length_check"
CHECK (
  "pronouns" IS NULL
  OR char_length(trim("pronouns")) <= 60
) NOT VALID;
--> statement-breakpoint

CREATE OR REPLACE VIEW onboarding_funnel_dimensions_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  event_type,
  COALESCE(step, 0) AS step,
  metadata->>'availabilityStatus' AS availability_status,
  metadata->>'messagePrivacy' AS message_privacy,
  metadata->>'visibility' AS visibility,
  COUNT(*) AS event_count
FROM onboarding_events
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY day DESC, event_type, step;
