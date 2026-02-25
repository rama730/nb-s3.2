CREATE TABLE IF NOT EXISTS profile_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_value jsonb DEFAULT NULL,
  next_value jsonb DEFAULT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS profile_audit_events_user_event_idx
ON profile_audit_events (user_id, event_type, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS profile_audit_events_user_created_idx
ON profile_audit_events (user_id, created_at);
--> statement-breakpoint
