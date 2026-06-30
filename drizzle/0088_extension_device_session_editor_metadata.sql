ALTER TABLE extension_device_sessions
  ADD COLUMN IF NOT EXISTS editor_host text,
  ADD COLUMN IF NOT EXISTS editor_name text,
  ADD COLUMN IF NOT EXISTS editor_platform text,
  ADD COLUMN IF NOT EXISTS editor_version text;

CREATE INDEX IF NOT EXISTS extension_device_sessions_editor_metadata_idx
  ON extension_device_sessions (user_id, editor_host, revoked_at, expires_at);
