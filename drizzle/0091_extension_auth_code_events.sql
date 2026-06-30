DO $$
BEGIN
  IF to_regclass('public.extension_device_session_events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.extension_device_session_events
    DROP CONSTRAINT IF EXISTS extension_device_session_events_event_type_check;

  ALTER TABLE public.extension_device_session_events
    ADD CONSTRAINT extension_device_session_events_event_type_check
    CHECK (
      event_type IN (
        'login',
        'file_write',
        'lock_acquire',
        'logout',
        'revocation',
        'auth_code_issued',
        'auth_code_consumed'
      )
    );
END $$;

