-- ============================================================================
-- Messaging reliability + scale hardening
-- - idempotent message sends (client_message_id)
-- - read watermark by message id
-- - DB-authoritative unread/order updates on INSERT
-- - stricter RLS and realtime publication for participant-scoped updates
-- ============================================================================

-- Extensions for trigram search
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
ALTER TABLE conversation_participants
    ADD COLUMN IF NOT EXISTS last_read_message_id uuid,
    ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS client_message_id text;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS conversation_participants_active_idx
ON conversation_participants (user_id, archived_at, last_message_at DESC);

CREATE INDEX IF NOT EXISTS messages_sender_created_idx
ON messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_content_trgm_idx
ON messages USING gin (content gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_sender_client_unique
ON messages (conversation_id, sender_id, client_message_id);

CREATE INDEX IF NOT EXISTS messages_conversation_sender_client_lookup_idx
ON messages (conversation_id, sender_id, client_message_id, created_at DESC)
WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_participants_read_watermark_idx
ON conversation_participants (conversation_id, user_id, last_read_message_id);

-- ---------------------------------------------------------------------------
-- DB-authoritative consistency trigger for message insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_message_insert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Keep conversation ordering authoritative in DB.
  UPDATE conversations
  SET updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;

  -- Recipients: increment unread and unarchive on new activity.
  UPDATE conversation_participants
  SET unread_count = unread_count + 1,
      last_message_at = NEW.created_at,
      archived_at = NULL
  WHERE conversation_id = NEW.conversation_id
    AND (NEW.sender_id IS NULL OR user_id <> NEW.sender_id);

  -- Sender: mark read watermark, clear unread, unarchive.
  IF NEW.sender_id IS NOT NULL THEN
    UPDATE conversation_participants
    SET unread_count = 0,
        last_message_at = NEW.created_at,
        last_read_at = NEW.created_at,
        last_read_message_id = NEW.id,
        archived_at = NULL
    WHERE conversation_id = NEW.conversation_id
      AND user_id = NEW.sender_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_after_insert_consistency ON messages;
CREATE TRIGGER trg_messages_after_insert_consistency
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_message_insert_consistency();

-- ---------------------------------------------------------------------------
-- RLS hardening
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
ON conversations FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update their participation" ON conversation_participants;
CREATE POLICY "Users can update their participation"
ON conversation_participants FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
CREATE POLICY "Users can delete their own messages"
ON messages FOR UPDATE
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Supabase Realtime publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'conversation_participants'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants';
    END IF;
  END IF;
END $$;
