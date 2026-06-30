ALTER TABLE "project_update_comments"
    ADD COLUMN IF NOT EXISTS "parent_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
    ALTER TABLE "project_update_comments"
        ADD CONSTRAINT "project_update_comments_parent_id_project_update_comments_id_fk"
        FOREIGN KEY ("parent_id")
        REFERENCES "project_update_comments"("id")
        ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    ALTER TABLE "project_update_comments"
        ADD CONSTRAINT "project_update_comments_no_self_parent_check"
        CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_update_comments_parent_idx"
    ON "project_update_comments" ("parent_id")
    WHERE "parent_id" IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'project_update_comments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE "project_update_comments";
    END IF;
END $$;
