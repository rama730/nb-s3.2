-- ============================================================================
-- Messaging media hardening: path-based attachment source of truth
-- - store object storage path on attachments
-- - keep URL column for backward compatibility while readers migrate to
--   short-lived signed URL generation.
-- ============================================================================

ALTER TABLE message_attachments
    ADD COLUMN IF NOT EXISTS storage_path text;

-- Best-effort backfill from legacy signed URLs.
UPDATE message_attachments
SET storage_path = substring(url from '/object/sign/chat-attachments/([^?]+)')
WHERE storage_path IS NULL
  AND url LIKE '%/object/sign/chat-attachments/%';

UPDATE message_attachments
SET storage_path = substring(url from '/render/image/sign/chat-attachments/([^?]+)')
WHERE storage_path IS NULL
  AND url LIKE '%/render/image/sign/chat-attachments/%';

CREATE INDEX IF NOT EXISTS message_attachments_storage_path_idx
ON message_attachments (storage_path);
