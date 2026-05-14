-- ============================================================================
-- Migration: message_reactions table for reliable real-time reaction events
--
-- Bug Condition: Supabase postgres_changes does not reliably fire for
-- JSONB-only updates to messages.metadata.reactionSummary.
--
-- Expected Behavior: Row-level changes in a dedicated message_reactions table
-- are reliably detected by Supabase real-time subscriptions.
--
-- This migration ensures the message_reactions table exists with proper
-- constraints, indexes, RLS policies, and real-time publication membership.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "message_reactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "message_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "emoji" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- FOREIGN KEYS
-- ---------------------------------------------------------------------------
DO $$ BEGIN
 ALTER TABLE "message_reactions"
    ADD CONSTRAINT "message_reactions_message_id_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "public"."messages"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_reactions"
    ADD CONSTRAINT "message_reactions_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- UNIQUE CONSTRAINT: one reaction per user per emoji per message
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_user_emoji_unique"
    ON "message_reactions" USING btree ("message_id", "user_id", "emoji");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "message_reactions_message_idx"
    ON "message_reactions" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reactions_message_emoji_idx"
    ON "message_reactions" USING btree ("message_id", "emoji");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE "message_reactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint

DROP POLICY IF EXISTS "Users can remove their own reactions"
    ON "message_reactions";
CREATE POLICY "Users can remove their own reactions"
ON "message_reactions" FOR DELETE
USING (user_id = auth.uid());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- REALTIME PUBLICATION
-- Enables Supabase postgres_changes to fire INSERT/DELETE events for
-- message_reactions rows, solving the JSONB-only update detection issue.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "message_reactions";
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
