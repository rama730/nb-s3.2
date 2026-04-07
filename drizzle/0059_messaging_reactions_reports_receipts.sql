-- Migration: message_reactions, message_reports, message_read_receipts tables
-- Also adds pinned_at column to conversation_participants

-- ============================================================================
-- MESSAGE REACTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS "message_reactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "message_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "emoji" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

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

CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_user_emoji_unique"
    ON "message_reactions" USING btree ("message_id", "user_id", "emoji");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reactions_message_idx"
    ON "message_reactions" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reactions_user_idx"
    ON "message_reactions" USING btree ("user_id");
--> statement-breakpoint

-- ============================================================================
-- MESSAGE REPORTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS "message_reports" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "message_id" uuid NOT NULL,
    "reporter_id" uuid NOT NULL,
    "reason" text NOT NULL,
    "details" text,
    "status" text DEFAULT 'pending' NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_reports"
    ADD CONSTRAINT "message_reports_message_id_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "public"."messages"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_reports"
    ADD CONSTRAINT "message_reports_reporter_id_profiles_id_fk"
    FOREIGN KEY ("reporter_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reports_message_idx"
    ON "message_reports" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reports_reporter_idx"
    ON "message_reports" USING btree ("reporter_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reports_status_idx"
    ON "message_reports" USING btree ("status", "created_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "message_reports_message_reporter_unique"
    ON "message_reports" USING btree ("message_id", "reporter_id");
--> statement-breakpoint

-- ============================================================================
-- MESSAGE READ RECEIPTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS "message_read_receipts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "message_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_read_receipts"
    ADD CONSTRAINT "message_read_receipts_message_id_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "public"."messages"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_read_receipts"
    ADD CONSTRAINT "message_read_receipts_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "message_read_receipts_message_user_unique"
    ON "message_read_receipts" USING btree ("message_id", "user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_read_receipts_message_idx"
    ON "message_read_receipts" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_read_receipts_user_idx"
    ON "message_read_receipts" USING btree ("user_id", "read_at");
--> statement-breakpoint

-- ============================================================================
-- ADD pinned_at TO conversation_participants
-- ============================================================================
ALTER TABLE "conversation_participants"
    ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;
