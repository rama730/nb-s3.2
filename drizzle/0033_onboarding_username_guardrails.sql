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

CREATE TABLE IF NOT EXISTS reserved_usernames (
    username text PRIMARY KEY,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

INSERT INTO reserved_usernames (username, reason) VALUES
    ('admin', 'system'),
    ('edge', 'brand'),
    ('api', 'system'),
    ('www', 'system'),
    ('mail', 'system'),
    ('support', 'system'),
    ('help', 'system'),
    ('settings', 'system'),
    ('profile', 'system'),
    ('login', 'auth'),
    ('signup', 'auth'),
    ('auth', 'auth'),
    ('onboarding', 'system')
ON CONFLICT (username) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_profile_username_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.username IS NULL THEN
        RETURN NEW;
    END IF;

    NEW.username := lower(trim(NEW.username));

    IF NEW.username !~ '^[a-z0-9_]{3,20}$' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid username format';
    END IF;

    IF EXISTS (SELECT 1 FROM public.reserved_usernames WHERE username = NEW.username) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Username is reserved';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS profiles_username_rules_trigger ON profiles;
--> statement-breakpoint

CREATE TRIGGER profiles_username_rules_trigger
BEFORE INSERT OR UPDATE OF username ON profiles
FOR EACH ROW
EXECUTE FUNCTION enforce_profile_username_rules();
