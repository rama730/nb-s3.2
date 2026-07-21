-- Current availability was a volatile presence signal presented as profile data.
-- Role intent now lives in open_to, experience_level, and hours_per_week.
ALTER TABLE "profiles" DROP COLUMN IF EXISTS "availability_status";
--> statement-breakpoint

GRANT SELECT (experience_level, hours_per_week) ON TABLE public.profiles TO anon, authenticated;
--> statement-breakpoint

DROP VIEW IF EXISTS onboarding_funnel_dimensions_daily;
--> statement-breakpoint
CREATE VIEW onboarding_funnel_dimensions_daily WITH (security_invoker = true) AS
SELECT
  date_trunc('day', created_at)::date AS day,
  event_type,
  COALESCE(step, 0) AS step,
  metadata->>'messagePrivacy' AS message_privacy,
  metadata->>'visibility' AS visibility,
  COUNT(*) AS event_count
FROM onboarding_events
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4, 5
ORDER BY day DESC, event_type, step;
