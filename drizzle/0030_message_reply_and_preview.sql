-- ============================================================================
-- Message replies + preview support
-- - adds first-class reply relation for WhatsApp-style replies
-- - indexes for scalable thread rendering and jump-to-reply
-- ============================================================================

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS reply_to_message_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'messages_reply_to_message_id_fkey'
    ) THEN
        ALTER TABLE messages
        ADD CONSTRAINT messages_reply_to_message_id_fkey
        FOREIGN KEY (reply_to_message_id)
        REFERENCES messages(id)
        ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS messages_reply_idx
ON messages (reply_to_message_id);

CREATE INDEX IF NOT EXISTS messages_conversation_reply_created_idx
ON messages (conversation_id, reply_to_message_id, created_at DESC);
