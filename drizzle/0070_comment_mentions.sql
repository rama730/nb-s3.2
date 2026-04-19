-- ============================================================================
-- Task Panel Overhaul — Wave 1: comment_mentions table
--
-- When a user @mentions a teammate inside a task comment, the raw text stored
-- in `task_comments.content` keeps a stable token `@{userId}|DisplayName`, and
-- we additionally write one `comment_mentions` row per distinct mentioned user.
--
-- Why a separate table (rather than a jsonb array on the comment):
--   • Indexed lookup "who was mentioned in task X" / "show me my mentions" is
--     free with a btree on `mentioned_user_id`.
--   • Notification fan-out inserts can be batched and audited independently of
--     the comment write.
--   • Cascading delete of the comment removes mention rows automatically.
--
-- The realtime publication entry is added in 0071.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "comment_mentions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "comment_id" uuid NOT NULL,
    "mentioned_user_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "comment_mentions"
    ADD CONSTRAINT "comment_mentions_comment_id_task_comments_id_fk"
    FOREIGN KEY ("comment_id")
    REFERENCES "public"."task_comments"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "comment_mentions"
    ADD CONSTRAINT "comment_mentions_mentioned_user_id_profiles_id_fk"
    FOREIGN KEY ("mentioned_user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "comment_mentions_comment_user_unique"
    ON "comment_mentions" USING btree ("comment_id", "mentioned_user_id");
--> statement-breakpoint

-- "Show me my mentions" inbox query: recent mentions for a user.
CREATE INDEX IF NOT EXISTS "comment_mentions_user_created_idx"
    ON "comment_mentions" USING btree ("mentioned_user_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "comment_mentions_comment_idx"
    ON "comment_mentions" USING btree ("comment_id");
--> statement-breakpoint

-- ============================================================================
-- Row-Level Security
--
-- SELECT: the mentioned user (for their inbox) OR anyone who can read the
-- parent comment (same visibility as task_comments).
-- INSERT: comment author, against their own comment. Duplicate inserts are
-- absorbed by the UNIQUE index via ON CONFLICT DO NOTHING in the server action.
-- No UPDATE/DELETE; lifecycle follows the parent comment.
-- ============================================================================
ALTER TABLE "comment_mentions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "comment_mentions_read" ON "comment_mentions";
CREATE POLICY "comment_mentions_read"
ON "comment_mentions" FOR SELECT
USING (
  mentioned_user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM "task_comments" tc
    JOIN "tasks" t ON tc.task_id = t.id
    JOIN "projects" p ON t.project_id = p.id
    WHERE tc.id = comment_mentions.comment_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM "project_members" m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "comment_mentions_write" ON "comment_mentions";
CREATE POLICY "comment_mentions_write"
ON "comment_mentions" FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "task_comments" tc
    WHERE tc.id = comment_mentions.comment_id
      AND tc.user_id = auth.uid()
  )
);
