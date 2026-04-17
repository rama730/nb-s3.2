-- ============================================================================
-- SEC-C7: Row-Level Security for message_reactions, message_reports,
--         message_read_receipts.
--
-- These tables were introduced in 0059 without RLS. Today the server accesses
-- them through a privileged connection, but any future realtime subscription
-- or direct Supabase client access would expose rows cross-tenant. Enabling
-- RLS now keeps the surface area tight regardless of who connects. Server
-- paths continue to use the service role, which bypasses RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE "message_reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_read_receipts" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- message_reactions: visible to any conversation participant, but a user
-- can only write or remove their OWN reaction row.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view reactions in their conversations"
    ON "message_reactions";
CREATE POLICY "Users can view reactions in their conversations"
ON "message_reactions" FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add their own reactions"
    ON "message_reactions";
CREATE POLICY "Users can add their own reactions"
ON "message_reactions" FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can remove their own reactions"
    ON "message_reactions";
CREATE POLICY "Users can remove their own reactions"
ON "message_reactions" FOR DELETE
USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- message_reports: reports are private between the reporter and moderators.
-- Reporters can see and insert their own rows only; updates (status,
-- reviewed_at, reviewed_by) must go through the service role / admin paths.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Reporters can view their own reports"
    ON "message_reports";
CREATE POLICY "Reporters can view their own reports"
ON "message_reports" FOR SELECT
USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Reporters can create their own reports"
    ON "message_reports";
CREATE POLICY "Reporters can create their own reports"
ON "message_reports" FOR INSERT
WITH CHECK (
  reporter_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_reports.message_id
      AND cp.user_id = auth.uid()
  )
);

-- No UPDATE/DELETE policy for end users — moderation actions run via the
-- privileged service role.

-- ---------------------------------------------------------------------------
-- message_read_receipts: visible to participants in the same conversation,
-- writable only by the receipt owner.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view read receipts in their conversations"
    ON "message_read_receipts";
CREATE POLICY "Users can view read receipts in their conversations"
ON "message_read_receipts" FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_read_receipts.message_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can upsert their own read receipts"
    ON "message_read_receipts";
CREATE POLICY "Users can upsert their own read receipts"
ON "message_read_receipts" FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_read_receipts.message_id
      AND cp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update their own read receipts"
    ON "message_read_receipts";
CREATE POLICY "Users can update their own read receipts"
ON "message_read_receipts" FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own read receipts"
    ON "message_read_receipts";
CREATE POLICY "Users can delete their own read receipts"
ON "message_read_receipts" FOR DELETE
USING (user_id = auth.uid());
