-- ============================================================================
-- Wave 1 — Receipt persistence: message_delivery_receipts table
--
-- Parallel to message_read_receipts (0059), this table tracks when a message
-- has been received by a recipient's client. Together with read receipts it
-- drives the WhatsApp-style delivery state machine:
--
--   sent  →  delivered  →  read
--   (1 ✓)    (2 ✓✓ gray)   (2 ✓✓ blue)
--
-- A delivery receipt row means "user_id's client acknowledged receipt of
-- message_id". conversation_id is denormalized from messages for efficient
-- per-conversation realtime filtering (Supabase postgres_changes filter).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "message_delivery_receipts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "message_id" uuid NOT NULL,
    "conversation_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "delivered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_delivery_receipts"
    ADD CONSTRAINT "message_delivery_receipts_message_id_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "public"."messages"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_delivery_receipts"
    ADD CONSTRAINT "message_delivery_receipts_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id")
    REFERENCES "public"."conversations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_delivery_receipts"
    ADD CONSTRAINT "message_delivery_receipts_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "message_delivery_receipts_message_user_unique"
    ON "message_delivery_receipts" USING btree ("message_id", "user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_delivery_receipts_message_idx"
    ON "message_delivery_receipts" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_delivery_receipts_user_idx"
    ON "message_delivery_receipts" USING btree ("user_id", "delivered_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_delivery_receipts_conversation_idx"
    ON "message_delivery_receipts" USING btree ("conversation_id", "delivered_at");
--> statement-breakpoint

-- ============================================================================
-- Row-Level Security
-- ============================================================================
ALTER TABLE "message_delivery_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Senders of a message (and other conversation participants) can see who
-- received it. Same pattern as message_read_receipts RLS.
DROP POLICY IF EXISTS "Users can view delivery receipts in their conversations"
    ON "message_delivery_receipts";
CREATE POLICY "Users can view delivery receipts in their conversations"
ON "message_delivery_receipts" FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = message_delivery_receipts.conversation_id
      AND cp.user_id = auth.uid()
  )
);
--> statement-breakpoint

-- Recipients can only write their own delivery receipt rows.
DROP POLICY IF EXISTS "Users can insert their own delivery receipts"
    ON "message_delivery_receipts";
CREATE POLICY "Users can insert their own delivery receipts"
ON "message_delivery_receipts" FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = message_delivery_receipts.conversation_id
      AND cp.user_id = auth.uid()
  )
);
--> statement-breakpoint

-- No UPDATE or DELETE — delivery receipts are write-once.

-- ============================================================================
-- Realtime publication — needed for Supabase postgres_changes subscriptions
-- so the sender's UI can receive live delivery-receipt inserts.
-- ============================================================================
-- Note: If the supabase_realtime publication doesn't include this table yet,
-- add it. The ALTER is idempotent when wrapped in a DO block.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "message_delivery_receipts";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
