-- ============================================================================
-- Wave 1 — Denormalize conversation_id onto message_read_receipts
--
-- The existing message_read_receipts table (0059) has only message_id + user_id.
-- Adding conversation_id allows Supabase postgres_changes to filter inserts
-- by conversation, so the sender's realtime subscriber only receives receipts
-- for the active conversation instead of all receipts globally.
--
-- Also adds message_read_receipts to the supabase_realtime publication so
-- live blue-tick updates arrive via postgres_changes.
-- ============================================================================

-- Add the column (nullable first so existing rows don't break)
ALTER TABLE "message_read_receipts"
    ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint

-- Backfill from messages.conversation_id
UPDATE "message_read_receipts" rr
SET "conversation_id" = m."conversation_id"
FROM "messages" m
WHERE rr."message_id" = m."id"
  AND rr."conversation_id" IS NULL;
--> statement-breakpoint

-- Now make it NOT NULL for future inserts
ALTER TABLE "message_read_receipts"
    ALTER COLUMN "conversation_id" SET NOT NULL;
--> statement-breakpoint

-- FK to conversations
DO $$ BEGIN
 ALTER TABLE "message_read_receipts"
    ADD CONSTRAINT "message_read_receipts_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id")
    REFERENCES "public"."conversations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Index for per-conversation filtering (realtime + queries)
CREATE INDEX IF NOT EXISTS "message_read_receipts_conversation_idx"
    ON "message_read_receipts" USING btree ("conversation_id", "read_at");
--> statement-breakpoint

-- Update SELECT RLS to also allow lookup via conversation_id
-- (more efficient than the current message→conversation join for realtime)
DROP POLICY IF EXISTS "Users can view read receipts in their conversations"
    ON "message_read_receipts";
CREATE POLICY "Users can view read receipts in their conversations"
ON "message_read_receipts" FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = message_read_receipts.conversation_id
      AND cp.user_id = auth.uid()
  )
);
--> statement-breakpoint

-- Update INSERT RLS to use conversation_id directly
DROP POLICY IF EXISTS "Users can upsert their own read receipts"
    ON "message_read_receipts";
CREATE POLICY "Users can upsert their own read receipts"
ON "message_read_receipts" FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = message_read_receipts.conversation_id
      AND cp.user_id = auth.uid()
  )
);
--> statement-breakpoint

-- Add to realtime publication
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "message_read_receipts";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
