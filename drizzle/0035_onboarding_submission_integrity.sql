ALTER TABLE onboarding_drafts
ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint

ALTER TABLE onboarding_drafts
DROP CONSTRAINT IF EXISTS onboarding_drafts_step_range_check;
--> statement-breakpoint

ALTER TABLE onboarding_drafts
ADD CONSTRAINT onboarding_drafts_step_range_check
CHECK (step BETWEEN 1 AND 4) NOT VALID;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'onboarding_drafts_step_range_check'
      AND conrelid = 'onboarding_drafts'::regclass
  ) THEN
    ALTER TABLE onboarding_drafts
    VALIDATE CONSTRAINT onboarding_drafts_step_range_check;
  END IF;
END
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS onboarding_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submissions_user_key_uidx
ON onboarding_submissions (user_id, idempotency_key);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS onboarding_submissions_status_updated_idx
ON onboarding_submissions (status, updated_at);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pg_function_is_visible(oid)
  ) THEN
    CREATE FUNCTION set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS set_onboarding_submissions_updated_at ON onboarding_submissions;
--> statement-breakpoint

CREATE TRIGGER set_onboarding_submissions_updated_at
BEFORE UPDATE ON onboarding_submissions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE onboarding_submissions
DROP CONSTRAINT IF EXISTS onboarding_submissions_status_check;
--> statement-breakpoint

ALTER TABLE onboarding_submissions
ADD CONSTRAINT onboarding_submissions_status_check
CHECK (status IN ('processing', 'completed', 'failed')) NOT VALID;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'onboarding_submissions_status_check'
      AND conrelid = 'onboarding_submissions'::regclass
  ) THEN
    ALTER TABLE onboarding_submissions
    VALIDATE CONSTRAINT onboarding_submissions_status_check;
  END IF;
END
$$;
--> statement-breakpoint

ALTER TABLE profiles
DROP CONSTRAINT IF EXISTS profiles_onboarding_shape_check;
--> statement-breakpoint

ALTER TABLE profiles
ADD CONSTRAINT profiles_onboarding_shape_check
CHECK (
  (full_name IS NULL OR char_length(trim(full_name)) BETWEEN 2 AND 80)
  AND (headline IS NULL OR char_length(headline) <= 120)
  AND (bio IS NULL OR char_length(bio) <= 500)
  AND (location IS NULL OR char_length(location) <= 120)
  AND (
    website IS NULL
    OR (
      char_length(website) <= 200
      AND website ~ '^https?://'
    )
  )
  AND (
    visibility IS NULL
    OR visibility IN ('public', 'connections', 'private')
  )
  AND (
    skills IS NULL
    OR (
      jsonb_typeof(skills) = 'array'
      AND jsonb_array_length(skills) <= 25
    )
  )
  AND (
    interests IS NULL
    OR (
      jsonb_typeof(interests) = 'array'
      AND jsonb_array_length(interests) <= 25
    )
  )
) NOT VALID;
--> statement-breakpoint

DO $$
DECLARE
  rows_updated integer := 0;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id
      FROM profiles
      WHERE
        (
          full_name IS NOT NULL
          AND (
            char_length(trim(full_name)) < 2
            OR left(trim(full_name), 80) <> full_name
          )
        )
        OR (headline IS NOT NULL AND left(headline, 120) <> headline)
        OR (bio IS NOT NULL AND left(bio, 500) <> bio)
        OR (location IS NOT NULL AND left(location, 120) <> location)
        OR (
          website IS NOT NULL
          AND (
            website !~ '^https?://'
            OR left(website, 200) <> website
          )
        )
        OR visibility IS NULL
        OR visibility NOT IN ('public', 'connections', 'private')
        OR skills IS NULL
        OR jsonb_typeof(skills) <> 'array'
        OR (jsonb_typeof(skills) = 'array' AND jsonb_array_length(skills) > 25)
        OR interests IS NULL
        OR jsonb_typeof(interests) <> 'array'
        OR (jsonb_typeof(interests) = 'array' AND jsonb_array_length(interests) > 25)
      ORDER BY id
      LIMIT 500
    )
    UPDATE profiles p
    SET
      full_name = CASE
        WHEN p.full_name IS NULL THEN NULL
        WHEN char_length(trim(p.full_name)) < 2 THEN NULL
        ELSE left(trim(p.full_name), 80)
      END,
      headline = CASE
        WHEN p.headline IS NULL THEN NULL
        ELSE left(p.headline, 120)
      END,
      bio = CASE
        WHEN p.bio IS NULL THEN NULL
        ELSE left(p.bio, 500)
      END,
      location = CASE
        WHEN p.location IS NULL THEN NULL
        ELSE left(p.location, 120)
      END,
      website = CASE
        WHEN p.website IS NULL THEN NULL
        WHEN p.website ~ '^https?://' THEN left(p.website, 200)
        ELSE NULL
      END,
      visibility = CASE
        WHEN p.visibility IN ('public', 'connections', 'private') THEN p.visibility
        ELSE 'public'
      END,
      skills = CASE
        WHEN p.skills IS NULL OR jsonb_typeof(p.skills) <> 'array' THEN '[]'::jsonb
        WHEN jsonb_array_length(p.skills) > 25 THEN (
          SELECT jsonb_agg(value)
          FROM (
            SELECT value
            FROM jsonb_array_elements(p.skills) WITH ORDINALITY AS arr(value, ord)
            ORDER BY ord
            LIMIT 25
          ) trimmed
        )
        ELSE p.skills
      END,
      interests = CASE
        WHEN p.interests IS NULL OR jsonb_typeof(p.interests) <> 'array' THEN '[]'::jsonb
        WHEN jsonb_array_length(p.interests) > 25 THEN (
          SELECT jsonb_agg(value)
          FROM (
            SELECT value
            FROM jsonb_array_elements(p.interests) WITH ORDINALITY AS arr(value, ord)
            ORDER BY ord
            LIMIT 25
          ) trimmed
        )
        ELSE p.interests
      END
    FROM batch
    WHERE p.id = batch.id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_onboarding_shape_check'
      AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles
    VALIDATE CONSTRAINT profiles_onboarding_shape_check;
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE VIEW onboarding_slo_daily AS
WITH base AS (
  SELECT
    date_trunc('day', created_at) AS day,
    event_type
  FROM onboarding_events
  WHERE created_at >= now() - interval '30 days'
)
SELECT
  day::date AS day,
  count(*) FILTER (WHERE event_type = 'submit_start') AS submit_starts,
  count(*) FILTER (WHERE event_type = 'submit_success') AS submit_successes,
  count(*) FILTER (WHERE event_type = 'submit_error') AS submit_errors,
  CASE
    WHEN count(*) FILTER (WHERE event_type = 'submit_start') = 0 THEN 1
    ELSE (
      count(*) FILTER (WHERE event_type = 'submit_success')::numeric
      / count(*) FILTER (WHERE event_type = 'submit_start')::numeric
    )
  END AS submit_success_rate
FROM base
GROUP BY day
ORDER BY day DESC;
