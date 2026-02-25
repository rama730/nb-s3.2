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
