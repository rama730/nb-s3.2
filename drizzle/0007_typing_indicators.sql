-- ============================================================================
-- TYPING INDICATORS - SIMPLE DATABASE APPROACH
-- Migration: 0007_typing_indicators.sql
-- Purpose: Simple, reliable typing indicator using database + realtime
-- ============================================================================

-- Create typing_indicators table
CREATE TABLE IF NOT EXISTS typing_indicators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    is_typing BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one row per user per conversation
    UNIQUE(conversation_id, user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_typing_conversation 
    ON typing_indicators(conversation_id) 
    WHERE is_typing = true;

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_typing_timestamp()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER typing_updated_at
    BEFORE UPDATE ON typing_indicators
    FOR EACH ROW
    EXECUTE FUNCTION update_typing_timestamp();

-- Auto-cleanup old typing indicators (older than 10 seconds)
CREATE OR REPLACE FUNCTION cleanup_old_typing_indicators()
RETURNS void
SET search_path = ''
AS $$
BEGIN
    DELETE FROM typing_indicators 
    WHERE updated_at < NOW() - INTERVAL '10 seconds';
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE typing_indicators ENABLE ROW LEVEL SECURITY;

-- Users can read typing indicators for their conversations
CREATE POLICY "Users can view typing in their conversations"
    ON typing_indicators FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = typing_indicators.conversation_id
            AND user_id = auth.uid()
        )
    );

-- Users can insert/update their own typing status
CREATE POLICY "Users can update own typing status"
    ON typing_indicators FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE typing_indicators;

COMMENT ON TABLE typing_indicators IS 'Tracks who is typing in each conversation - simple and reliable';
