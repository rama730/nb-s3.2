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
