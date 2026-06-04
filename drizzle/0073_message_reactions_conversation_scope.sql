ALTER TABLE "message_reactions"
  ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint

UPDATE "message_reactions" mr
SET "conversation_id" = m."conversation_id"
FROM "messages" m
WHERE mr."message_id" = m."id"
  AND mr."conversation_id" IS NULL;
--> statement-breakpoint

DELETE FROM "message_reactions"
WHERE "conversation_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "message_reactions"
  ALTER COLUMN "conversation_id" SET NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_reactions"
   ADD CONSTRAINT "message_reactions_conversation_id_conversations_id_fk"
   FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reactions_conversation_idx"
  ON "message_reactions" ("conversation_id");
