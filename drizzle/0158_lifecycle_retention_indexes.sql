-- Support bounded retention key scans without full-table sorts. Lifecycle
-- ownership remains in the registered Inngest worker; these indexes only make
-- its oldest-first SKIP LOCKED batches predictable as the tables grow.

CREATE INDEX IF NOT EXISTS profile_audit_events_retention_idx
  ON public.profile_audit_events (created_at, id);

CREATE INDEX IF NOT EXISTS onboarding_events_retention_idx
  ON public.onboarding_events (created_at, id);

CREATE INDEX IF NOT EXISTS extension_device_session_events_retention_idx
  ON public.extension_device_session_events (created_at, id);
