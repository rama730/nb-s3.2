-- Migration: Add conversation_id to projects for Project Groups
-- This enables O(1) lookup of a project's group chat.

ALTER TABLE "projects" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint

-- Add index for fast lookup
CREATE INDEX IF NOT EXISTS "projects_conversation_idx" ON "projects" USING btree ("conversation_id");--> statement-breakpoint

-- Add foreign key constraint
ALTER TABLE "projects" ADD CONSTRAINT "projects_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
