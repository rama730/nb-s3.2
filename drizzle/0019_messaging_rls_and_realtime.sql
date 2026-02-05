-- ============================================================================
-- MESSAGING: RLS policies + Supabase Realtime publication
-- Goal: clients only see/insert messages in conversations they participate in.
-- NOTE: server-side writes should use a privileged DB role (service) that bypasses RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
CREATE POLICY "Users can view their conversations"
ON conversations FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = conversations.id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
ON conversations FOR INSERT
WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Conversation participants
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = conversation_participants.conversation_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add themselves to conversations" ON conversation_participants;
CREATE POLICY "Users can add themselves to conversations"
ON conversation_participants FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their participation" ON conversation_participants;
CREATE POLICY "Users can update their participation"
ON conversation_participants FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
ON messages FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON messages;
CREATE POLICY "Users can send messages in their conversations"
ON messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can edit their own messages" ON messages;
CREATE POLICY "Users can edit their own messages"
ON messages FOR UPDATE
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Message attachments
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON message_attachments;
CREATE POLICY "Users can view attachments in their conversations"
ON message_attachments FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_attachments.message_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add attachments to their messages" ON message_attachments;
CREATE POLICY "Users can add attachments to their messages"
ON message_attachments FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.id = message_attachments.message_id
      AND m.sender_id = auth.uid()
  )
);

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
        AND tablename = 'messages'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
    END IF;
  END IF;
END $$;

