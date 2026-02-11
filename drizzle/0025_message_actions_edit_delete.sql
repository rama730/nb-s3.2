-- ============================================================================
-- Message actions foundation
-- - delete for me support via participant-scoped hidden state
-- - message edit logs for auditability
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_hidden_for_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    hidden_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_hidden_for_users_unique
ON message_hidden_for_users (message_id, user_id);

CREATE INDEX IF NOT EXISTS message_hidden_for_users_user_idx
ON message_hidden_for_users (user_id, hidden_at DESC);

CREATE INDEX IF NOT EXISTS message_hidden_for_users_message_idx
ON message_hidden_for_users (message_id);

CREATE TABLE IF NOT EXISTS message_edit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    editor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    previous_content text,
    next_content text,
    edited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_edit_logs_message_idx
ON message_edit_logs (message_id, edited_at DESC);

CREATE INDEX IF NOT EXISTS message_edit_logs_editor_idx
ON message_edit_logs (editor_id, edited_at DESC);
