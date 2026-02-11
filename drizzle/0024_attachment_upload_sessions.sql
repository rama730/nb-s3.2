-- ============================================================================
-- Attachment upload sessions for reliable multi-file sending
-- ============================================================================

CREATE TABLE IF NOT EXISTS attachment_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_upload_id text NOT NULL,
    conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
    storage_path text,
    filename text NOT NULL,
    mime_type text,
    size_bytes integer,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'uploading', 'uploaded', 'committed', 'failed', 'canceled')),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS attachment_uploads_user_client_unique
ON attachment_uploads (user_id, client_upload_id);

CREATE INDEX IF NOT EXISTS attachment_uploads_user_status_idx
ON attachment_uploads (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS attachment_uploads_storage_path_idx
ON attachment_uploads (storage_path);

CREATE INDEX IF NOT EXISTS attachment_uploads_conversation_idx
ON attachment_uploads (conversation_id, updated_at DESC);
