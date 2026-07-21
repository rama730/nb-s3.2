ALTER TABLE extension_device_sessions
  ADD COLUMN IF NOT EXISTS callback_uri text;
