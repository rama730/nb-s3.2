-- ============================================================================
-- Messaging collaboration foundation
-- - denormalized participant preview fields for low-churn inbox/sidebar updates
-- - workflow persistence for stateful structured cards and private follow-ups
-- - DB-authoritative preview consistency on message INSERT
-- ============================================================================

ALTER TABLE "conversation_participants"
    ADD COLUMN IF NOT EXISTS "last_message_id" uuid,
    ADD COLUMN IF NOT EXISTS "last_message_preview" text,
    ADD COLUMN IF NOT EXISTS "last_message_type" text,
    ADD COLUMN IF NOT EXISTS "last_message_sender_id" uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conversation_participants_user_last_message_idx"
    ON "conversation_participants" USING btree ("user_id", "last_message_at", "last_message_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "message_workflow_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "message_id" uuid,
    "conversation_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "scope" text DEFAULT 'conversation' NOT NULL,
    "creator_id" uuid NOT NULL,
    "assignee_user_id" uuid,
    "project_id" uuid,
    "task_id" uuid,
    "status" text DEFAULT 'pending' NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "due_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_workflow_items"
    ADD CONSTRAINT "message_workflow_items_message_id_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "public"."messages"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_workflow_items"
    ADD CONSTRAINT "message_workflow_items_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id")
    REFERENCES "public"."conversations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_workflow_items"
    ADD CONSTRAINT "message_workflow_items_creator_id_profiles_id_fk"
    FOREIGN KEY ("creator_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_workflow_items"
    ADD CONSTRAINT "message_workflow_items_assignee_user_id_profiles_id_fk"
    FOREIGN KEY ("assignee_user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_workflow_items"
    ADD CONSTRAINT "message_workflow_items_project_id_projects_id_fk"
    FOREIGN KEY ("project_id")
    REFERENCES "public"."projects"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_workflow_items"
    ADD CONSTRAINT "message_workflow_items_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id")
    REFERENCES "public"."tasks"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_workflow_items_conversation_idx"
    ON "message_workflow_items" USING btree ("conversation_id", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_workflow_items_message_idx"
    ON "message_workflow_items" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_workflow_items_assignee_idx"
    ON "message_workflow_items" USING btree ("assignee_user_id", "status", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_workflow_items_creator_scope_idx"
    ON "message_workflow_items" USING btree ("creator_id", "scope", "status", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_workflow_items_kind_status_idx"
    ON "message_workflow_items" USING btree ("kind", "status", "updated_at");

DROP INDEX IF EXISTS "messages_content_search_idx";
CREATE INDEX IF NOT EXISTS "messages_content_search_idx"
    ON "messages" USING gin (
        to_tsvector(
            'english',
            concat_ws(
                ' ',
                coalesce("content", ''),
                coalesce("metadata" #>> '{structured,title}', ''),
                coalesce("metadata" #>> '{structured,summary}', '')
            )
        )
    );

CREATE INDEX IF NOT EXISTS "messages_structured_kind_idx"
    ON "messages" USING btree ((coalesce("metadata" #>> '{structured,kind}', '')))
    WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "message_workflow_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "Conversation participants can view workflow items" ON "message_workflow_items";
CREATE POLICY "Conversation participants can view workflow items"
ON "message_workflow_items" FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "conversation_participants" cp
        WHERE cp.conversation_id = message_workflow_items.conversation_id
          AND cp.user_id = auth.uid()
    )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Participants can create workflow items" ON "message_workflow_items";
CREATE POLICY "Participants can create workflow items"
ON "message_workflow_items" FOR INSERT
WITH CHECK (
    creator_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM "conversation_participants" cp
        WHERE cp.conversation_id = message_workflow_items.conversation_id
          AND cp.user_id = auth.uid()
    )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Participants can update workflow items" ON "message_workflow_items";
CREATE POLICY "Participants can update workflow items"
ON "message_workflow_items" FOR UPDATE
USING (
    creator_id = auth.uid()
    OR assignee_user_id = auth.uid()
)
WITH CHECK (
    creator_id = auth.uid()
    OR assignee_user_id = auth.uid()
);
--> statement-breakpoint

-- ============================================================================
-- Message Linked Work
--
-- Canonical source-to-destination projection for task conversions, private
-- follow-ups, workflow requests, file reviews, and decision records.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "message_work_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_message_id" uuid NOT NULL,
  "source_conversation_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "target_project_id" uuid,
  "visibility" text DEFAULT 'shared' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "owner_user_id" uuid,
  "assignee_user_id" uuid,
  "created_by" uuid NOT NULL,
  "href" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "message_work_links_target_type_check"
    CHECK ("target_type" IN ('task', 'follow_up', 'workflow', 'file_review', 'decision')),
  CONSTRAINT "message_work_links_visibility_check"
    CHECK ("visibility" IN ('private', 'shared')),
  CONSTRAINT "message_work_links_status_check"
    CHECK ("status" IN ('pending', 'active', 'done', 'dismissed', 'blocked', 'unavailable'))
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_work_links"
    ADD CONSTRAINT "message_work_links_source_message_id_messages_id_fk"
    FOREIGN KEY ("source_message_id")
    REFERENCES "public"."messages"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_work_links"
    ADD CONSTRAINT "message_work_links_source_conversation_id_conversations_id_fk"
    FOREIGN KEY ("source_conversation_id")
    REFERENCES "public"."conversations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_work_links"
    ADD CONSTRAINT "message_work_links_target_project_id_projects_id_fk"
    FOREIGN KEY ("target_project_id")
    REFERENCES "public"."projects"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_work_links"
    ADD CONSTRAINT "message_work_links_owner_user_id_profiles_id_fk"
    FOREIGN KEY ("owner_user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_work_links"
    ADD CONSTRAINT "message_work_links_assignee_user_id_profiles_id_fk"
    FOREIGN KEY ("assignee_user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "message_work_links"
    ADD CONSTRAINT "message_work_links_created_by_profiles_id_fk"
    FOREIGN KEY ("created_by")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_work_links_source_message_idx"
  ON "message_work_links" USING btree ("source_message_id", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_work_links_conversation_idx"
  ON "message_work_links" USING btree ("source_conversation_id", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_work_links_assignee_status_idx"
  ON "message_work_links" USING btree ("assignee_user_id", "status", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_work_links_owner_private_idx"
  ON "message_work_links" USING btree ("owner_user_id", "visibility", "status", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_work_links_target_idx"
  ON "message_work_links" USING btree ("target_type", "target_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_work_links_project_idx"
  ON "message_work_links" USING btree ("target_project_id", "updated_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "message_work_links_source_target_unique"
  ON "message_work_links" USING btree ("source_message_id", "target_type", "target_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "message_work_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "Conversation participants can view message work links" ON "message_work_links";
CREATE POLICY "Conversation participants can view message work links"
ON "message_work_links" FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM "conversation_participants" cp
    WHERE cp.conversation_id = message_work_links.source_conversation_id
      AND cp.user_id = auth.uid()
  )
  AND (
    message_work_links.visibility = 'shared'
    OR message_work_links.owner_user_id = auth.uid()
    OR message_work_links.created_by = auth.uid()
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Conversation participants can create message work links" ON "message_work_links";
CREATE POLICY "Conversation participants can create message work links"
ON "message_work_links" FOR INSERT
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "conversation_participants" cp
    WHERE cp.conversation_id = message_work_links.source_conversation_id
      AND cp.user_id = auth.uid()
  )
  AND (
    message_work_links.visibility = 'shared'
    OR message_work_links.owner_user_id = auth.uid()
  )
);
--> statement-breakpoint

DROP POLICY IF EXISTS "Owners and assignees can update message work links" ON "message_work_links";
CREATE POLICY "Owners and assignees can update message work links"
ON "message_work_links" FOR UPDATE
USING (
  created_by = auth.uid()
  OR owner_user_id = auth.uid()
  OR assignee_user_id = auth.uid()
)
WITH CHECK (
  created_by = auth.uid()
  OR owner_user_id = auth.uid()
  OR assignee_user_id = auth.uid()
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.handle_message_insert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  preview_text text;
  preview_type text;
BEGIN
  preview_text := CASE
    WHEN jsonb_typeof(NEW.metadata->'structured') = 'object' THEN COALESCE(
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
      'Workflow update'
    )
    WHEN NULLIF(btrim(COALESCE(NEW.content, '')), '') IS NOT NULL THEN left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 160)
    WHEN NEW.type = 'image' THEN 'Photo'
    WHEN NEW.type = 'video' THEN 'Video'
    WHEN NEW.type = 'file' THEN 'Attachment'
    WHEN NEW.type = 'system' THEN 'System update'
    ELSE 'Message'
  END;

  preview_type := COALESCE(NULLIF(NEW.metadata #>> '{structured,kind}', ''), NEW.type, 'text');

  UPDATE conversations
  SET updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;

  UPDATE conversation_participants
  SET unread_count = unread_count + 1,
      last_message_at = NEW.created_at,
      last_message_id = NEW.id,
      last_message_preview = preview_text,
      last_message_type = preview_type,
      last_message_sender_id = NEW.sender_id,
      archived_at = NULL
  WHERE conversation_id = NEW.conversation_id
    AND (NEW.sender_id IS NULL OR user_id <> NEW.sender_id);

  IF NEW.sender_id IS NOT NULL THEN
    UPDATE conversation_participants
    SET unread_count = 0,
        last_message_at = NEW.created_at,
        last_message_id = NEW.id,
        last_message_preview = preview_text,
        last_message_type = preview_type,
        last_message_sender_id = NEW.sender_id,
        last_read_at = NEW.created_at,
        last_read_message_id = NEW.id,
        archived_at = NULL
    WHERE conversation_id = NEW.conversation_id
      AND user_id = NEW.sender_id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

UPDATE "conversation_participants" cp
SET
    "last_message_at" = latest.created_at,
    "last_message_id" = latest.id,
    "last_message_preview" = latest.preview_text,
    "last_message_type" = latest.preview_type,
    "last_message_sender_id" = latest.sender_id
FROM (
    SELECT
        cp_inner.id AS participant_id,
        m.id,
        m.created_at,
        m.sender_id,
        COALESCE(NULLIF(m.metadata #>> '{structured,kind}', ''), m.type, 'text') AS preview_type,
        CASE
            WHEN jsonb_typeof(m.metadata->'structured') = 'object' THEN COALESCE(
                NULLIF(left(regexp_replace(COALESCE(m.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
                NULLIF(left(regexp_replace(COALESCE(m.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
                'Workflow update'
            )
            WHEN NULLIF(btrim(COALESCE(m.content, '')), '') IS NOT NULL THEN left(regexp_replace(COALESCE(m.content, ''), '\s+', ' ', 'g'), 160)
            WHEN m.type = 'image' THEN 'Photo'
            WHEN m.type = 'video' THEN 'Video'
            WHEN m.type = 'file' THEN 'Attachment'
            WHEN m.type = 'system' THEN 'System update'
            ELSE 'Message'
        END AS preview_text
    FROM "conversation_participants" cp_inner
    LEFT JOIN LATERAL (
        SELECT m.*
        FROM "messages" m
        WHERE m.conversation_id = cp_inner.conversation_id
          AND m.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "message_hidden_for_users" h
              WHERE h.message_id = m.id
                AND h.user_id = cp_inner.user_id
          )
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
    ) m ON true
) latest
WHERE cp.id = latest.participant_id;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "messages_after_insert_consistency" ON "messages";
DROP TRIGGER IF EXISTS "trg_messages_after_insert_consistency" ON "messages";
CREATE TRIGGER "trg_messages_after_insert_consistency"
AFTER INSERT ON "messages"
FOR EACH ROW
EXECUTE FUNCTION public.handle_message_insert_consistency();
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'message_workflow_items'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_workflow_items';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'message_work_links'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_work_links';
    END IF;
  END IF;
END $$;
