-- ============================================================================
-- MESSAGING SYSTEM TABLES
-- Real-time DM messaging with Supabase
-- ============================================================================

-- ============================================================================
-- CONVERSATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL DEFAULT 'dm' CHECK (type IN ('dm', 'group')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- CONVERSATION PARTICIPANTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    muted BOOLEAN DEFAULT FALSE,
    UNIQUE(conversation_id, user_id)
);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    content TEXT,
    type TEXT DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'file', 'system')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Add full-text search vector (generated column)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS search_vector TSVECTOR 
GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;

-- ============================================================================
-- MESSAGE ATTACHMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('image', 'video', 'file')),
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER,
    mime_type TEXT,
    thumbnail_url TEXT,
    width INTEGER,
    height INTEGER,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Fast message retrieval by conversation (most critical query)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
    ON messages(conversation_id, created_at DESC);

-- Fast participant lookup by user
CREATE INDEX IF NOT EXISTS idx_participants_user 
    ON conversation_participants(user_id);

-- Fast participant lookup by conversation
CREATE INDEX IF NOT EXISTS idx_participants_conversation 
    ON conversation_participants(conversation_id);

-- Composite index for unread count queries
CREATE INDEX IF NOT EXISTS idx_participants_user_read 
    ON conversation_participants(user_id, last_read_at);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_messages_search 
    ON messages USING GIN(search_vector);

-- Attachment lookup by message
CREATE INDEX IF NOT EXISTS idx_attachments_message 
    ON message_attachments(message_id);

-- Updated_at index for conversation ordering
CREATE INDEX IF NOT EXISTS idx_conversations_updated 
    ON conversations(updated_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- CONVERSATIONS RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
CREATE POLICY "Users can view their conversations"
ON conversations FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM conversation_participants
        WHERE conversation_id = conversations.id
        AND user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
ON conversations FOR INSERT
WITH CHECK (true);

-- CONVERSATION PARTICIPANTS RLS
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants FOR SELECT
USING (
    user_id = auth.uid() OR
    EXISTS (
        SELECT 1 FROM conversation_participants cp
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
USING (user_id = auth.uid());

-- MESSAGES RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
ON messages FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM conversation_participants
        WHERE conversation_id = messages.conversation_id
        AND user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON messages;
CREATE POLICY "Users can send messages in their conversations"
ON messages FOR INSERT
WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
        SELECT 1 FROM conversation_participants
        WHERE conversation_id = messages.conversation_id
        AND user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Users can edit their own messages" ON messages;
CREATE POLICY "Users can edit their own messages"
ON messages FOR UPDATE
USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can soft delete their own messages" ON messages;
CREATE POLICY "Users can soft delete their own messages"
ON messages FOR UPDATE
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- MESSAGE ATTACHMENTS RLS
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON message_attachments;
CREATE POLICY "Users can view attachments in their conversations"
ON message_attachments FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM messages m
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
        SELECT 1 FROM messages m
        WHERE m.id = message_attachments.message_id
        AND m.sender_id = auth.uid()
    )
);

-- ============================================================================
-- REALTIME PUBLICATION
-- Enable realtime for messages table
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ============================================================================
-- HELPER FUNCTION: Get or create DM conversation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_or_create_dm_conversation(
    user_a UUID,
    user_b UUID
) RETURNS UUID AS $$
DECLARE
    conversation_id UUID;
BEGIN
    -- Try to find existing DM conversation between these two users
    SELECT c.id INTO conversation_id
    FROM conversations c
    WHERE c.type = 'dm'
    AND EXISTS (
        SELECT 1 FROM conversation_participants cp1
        WHERE cp1.conversation_id = c.id AND cp1.user_id = user_a
    )
    AND EXISTS (
        SELECT 1 FROM conversation_participants cp2
        WHERE cp2.conversation_id = c.id AND cp2.user_id = user_b
    )
    AND (
        SELECT COUNT(*) FROM conversation_participants cp3
        WHERE cp3.conversation_id = c.id
    ) = 2;
    
    -- If no conversation exists, create one
    IF conversation_id IS NULL THEN
        INSERT INTO conversations (type) VALUES ('dm') RETURNING id INTO conversation_id;
        INSERT INTO conversation_participants (conversation_id, user_id) VALUES (conversation_id, user_a);
        INSERT INTO conversation_participants (conversation_id, user_id) VALUES (conversation_id, user_b);
    END IF;
    
    RETURN conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- HELPER FUNCTION: Update conversation updated_at on new message
-- ============================================================================
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.conversations 
    SET updated_at = NOW() 
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages;
CREATE TRIGGER trigger_update_conversation_timestamp
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_timestamp();

-- ============================================================================
-- ANALYZE TABLES
-- ============================================================================
ANALYZE conversations;
ANALYZE conversation_participants;
ANALYZE messages;
ANALYZE message_attachments;
