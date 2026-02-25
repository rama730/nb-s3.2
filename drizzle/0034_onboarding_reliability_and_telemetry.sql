-- Normalize username casing/whitespace before validation.
UPDATE profiles
SET username = lower(trim(username))
WHERE username IS NOT NULL
  AND username <> lower(trim(username));
--> statement-breakpoint

-- Drop invalid or reserved usernames from legacy rows.
UPDATE profiles p
SET username = NULL
WHERE p.username IS NOT NULL
  AND (
    p.username !~ '^[a-z0-9_]{3,20}$'
    OR EXISTS (
      SELECT 1
      FROM reserved_usernames r
      WHERE r.username = p.username
    )
  );
--> statement-breakpoint

-- Resolve historical case-insensitive duplicates by preserving the newest row.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(username)
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM profiles
  WHERE username IS NOT NULL
)
UPDATE profiles p
SET username = NULL
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique_idx
ON profiles (lower(username))
WHERE username IS NOT NULL;
--> statement-breakpoint

ALTER TABLE profiles
DROP CONSTRAINT IF EXISTS profiles_username_format_check;
--> statement-breakpoint

ALTER TABLE profiles
ADD CONSTRAINT profiles_username_format_check
CHECK (
  username IS NULL
  OR username ~ '^[a-z0-9_]{3,20}$'
) NOT VALID;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_username_format_check'
      AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles
    VALIDATE CONSTRAINT profiles_username_format_check;
  END IF;
END
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS onboarding_drafts (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  step integer NOT NULL DEFAULT 1,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS onboarding_drafts_updated_at_idx
ON onboarding_drafts (updated_at);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS onboarding_drafts_updated_at_trigger ON onboarding_drafts;
--> statement-breakpoint

CREATE TRIGGER onboarding_drafts_updated_at_trigger
BEFORE UPDATE ON onboarding_drafts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  step integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS onboarding_events_user_idx
ON onboarding_events (user_id, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS onboarding_events_event_idx
ON onboarding_events (event_type, created_at);
