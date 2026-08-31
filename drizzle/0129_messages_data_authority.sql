-- Messaging data authority and lifecycle hardening.
-- Historical migrations remain append-only. This migration repairs current
-- drift before tightening constraints and removes browser ownership of
-- server/trigger-managed messaging state.

-- ---------------------------------------------------------------------------
-- Canonical DM registry shape and repair
-- ---------------------------------------------------------------------------
ALTER TABLE public.dm_pairs
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
--> statement-breakpoint

UPDATE public.dm_pairs SET id = gen_random_uuid() WHERE id IS NULL;
--> statement-breakpoint

ALTER TABLE public.dm_pairs
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS dm_pairs_user_low_user_high_key
  ON public.dm_pairs (user_low, user_high);
--> statement-breakpoint

DO $dm_primary_key$
DECLARE
  primary_key_name text;
  primary_key_columns text[];
BEGIN
  SELECT c.conname, array_agg(a.attname ORDER BY key_columns.ordinality)
  INTO primary_key_name, primary_key_columns
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key_columns.attnum
  WHERE c.conrelid = 'public.dm_pairs'::regclass
    AND c.contype = 'p'
  GROUP BY c.conname;

  IF primary_key_name IS NOT NULL AND primary_key_columns <> ARRAY['id']::text[] THEN
    EXECUTE format('ALTER TABLE public.dm_pairs DROP CONSTRAINT %I', primary_key_name);
    primary_key_name := NULL;
  END IF;

  IF primary_key_name IS NULL THEN
    ALTER TABLE public.dm_pairs
      ADD CONSTRAINT dm_pairs_pkey PRIMARY KEY (id);
  END IF;
END
$dm_primary_key$;
--> statement-breakpoint

DELETE FROM public.dm_pairs pair
USING public.conversations conversation
WHERE pair.conversation_id = conversation.id
  AND (
    conversation.type <> 'dm'
    OR (
      SELECT array_agg(participant.user_id ORDER BY participant.user_id)
      FROM public.conversation_participants participant
      WHERE participant.conversation_id = conversation.id
    ) IS DISTINCT FROM ARRAY[pair.user_low, pair.user_high]::uuid[]
  );
--> statement-breakpoint

INSERT INTO public.dm_pairs (user_low, user_high, conversation_id)
SELECT
  LEAST(min(cp.user_id::text), max(cp.user_id::text))::uuid,
  GREATEST(min(cp.user_id::text), max(cp.user_id::text))::uuid,
  c.id
FROM public.conversations c
JOIN public.conversation_participants cp ON cp.conversation_id = c.id
LEFT JOIN public.dm_pairs pair ON pair.conversation_id = c.id
WHERE c.type = 'dm'
  AND pair.conversation_id IS NULL
GROUP BY c.id
HAVING count(DISTINCT cp.user_id) = 2
   AND min(cp.user_id::text) <> max(cp.user_id::text)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Preserve corrupted multi-user/orphaned history without pretending it is a
-- direct message. Exact two-user DMs were repaired above; any remaining
-- unpaired row is a legacy group-shaped conversation.
UPDATE public.conversations conversation
SET type = 'group', updated_at = now()
WHERE conversation.type = 'dm'
  AND NOT EXISTS (
    SELECT 1
    FROM public.dm_pairs pair
    WHERE pair.conversation_id = conversation.id
  );
--> statement-breakpoint

ALTER TABLE public.dm_pairs
  DROP CONSTRAINT IF EXISTS dm_pairs_ordered_users_check,
  ADD CONSTRAINT dm_pairs_ordered_users_check
    CHECK (user_low < user_high) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.dm_pairs
  VALIDATE CONSTRAINT dm_pairs_ordered_users_check;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.nb_validate_dm_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_type text;
  pair_low uuid;
  pair_high uuid;
  participant_ids uuid[];
BEGIN
  SELECT c.type
  INTO conversation_type
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  -- Cascading conversation deletion is already valid.
  IF conversation_type IS NULL OR conversation_type <> 'dm' THEN
    RETURN;
  END IF;

  SELECT p.user_low, p.user_high
  INTO pair_low, pair_high
  FROM public.dm_pairs p
  WHERE p.conversation_id = p_conversation_id;

  SELECT array_agg(cp.user_id ORDER BY cp.user_id)
  INTO participant_ids
  FROM public.conversation_participants cp
  WHERE cp.conversation_id = p_conversation_id;

  IF pair_low IS NULL
     OR participant_ids IS NULL
     OR cardinality(participant_ids) <> 2
     OR participant_ids <> ARRAY[pair_low, pair_high]::uuid[] THEN
    RAISE EXCEPTION 'DM conversation % must have one matching pair and exactly two participants', p_conversation_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.nb_validate_dm_conversation_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.nb_validate_dm_conversation(
    COALESCE(NEW.conversation_id, OLD.conversation_id, NEW.id, OLD.id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.nb_validate_dm_conversation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.nb_validate_dm_conversation_trigger() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

DROP TRIGGER IF EXISTS conversation_participants_validate_dm ON public.conversation_participants;
CREATE CONSTRAINT TRIGGER conversation_participants_validate_dm
AFTER INSERT OR UPDATE OR DELETE ON public.conversation_participants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_private.nb_validate_dm_conversation_trigger();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dm_pairs_validate_dm ON public.dm_pairs;
CREATE CONSTRAINT TRIGGER dm_pairs_validate_dm
AFTER INSERT OR UPDATE OR DELETE ON public.dm_pairs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_private.nb_validate_dm_conversation_trigger();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Typed application history and normalized decision metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.role_applications
  ADD COLUMN IF NOT EXISTS decision_reason_code text,
  ADD COLUMN IF NOT EXISTS decision_reason_text text;
--> statement-breakpoint

UPDATE public.role_applications application
SET
  decision_reason_code = COALESCE(
    application.decision_reason_code,
    (
      SELECT m.metadata ->> 'reasonCode'
      FROM public.messages m
      WHERE m.metadata ->> 'applicationId' = application.id::text
        AND m.metadata ->> 'kind' IN ('application_update', 'application_decision')
        AND NULLIF(m.metadata ->> 'reasonCode', '') IS NOT NULL
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    )
  ),
  decision_reason_text = COALESCE(
    application.decision_reason_text,
    (
      SELECT m.metadata ->> 'customMessage'
      FROM public.messages m
      WHERE m.metadata ->> 'applicationId' = application.id::text
        AND m.metadata ->> 'kind' IN ('application_update', 'application_decision')
        AND NULLIF(m.metadata ->> 'customMessage', '') IS NOT NULL
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    )
  )
WHERE application.decision_reason_code IS NULL
   OR application.decision_reason_text IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.role_applications(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL,
  from_status text,
  to_status text,
  reason_code text,
  reason_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_events_kind_check CHECK (
    kind IN (
      'created', 'edited', 'withdrawn', 'reopened', 'accepted', 'rejected',
      'proposed', 'proposal_accepted', 'proposal_declined'
    )
  ),
  CONSTRAINT application_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS application_events_application_created_idx
  ON public.application_events (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS application_events_actor_created_idx
  ON public.application_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS application_events_kind_created_idx
  ON public.application_events (kind, created_at DESC);
--> statement-breakpoint

INSERT INTO public.application_events (
  application_id,
  actor_id,
  kind,
  from_status,
  to_status,
  reason_code,
  reason_text,
  created_at,
  metadata
)
SELECT
  a.id,
  COALESCE(a.decision_by, a.applicant_id),
  CASE a.status::text
    WHEN 'accepted' THEN 'accepted'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'withdrawn' THEN 'withdrawn'
    WHEN 'proposed' THEN 'proposed'
    ELSE 'created'
  END,
  NULL,
  a.status::text,
  a.decision_reason_code,
  a.decision_reason_text,
  COALESCE(a.decision_at, a.created_at),
  jsonb_build_object('backfilled', true)
FROM public.role_applications a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.application_events event
  WHERE event.application_id = a.id
);
--> statement-breakpoint

DROP TRIGGER IF EXISTS role_applications_append_event ON public.role_applications;
DROP FUNCTION IF EXISTS public.append_application_event();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Message pins and search authority
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_pins (
  message_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  pinned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_pins_message_conversation_fkey
    FOREIGN KEY (message_id, conversation_id)
    REFERENCES public.messages(id, conversation_id)
    ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS message_pins_conversation_pinned_idx
  ON public.message_pins (conversation_id, pinned_at DESC);
--> statement-breakpoint

INSERT INTO public.message_pins (message_id, conversation_id, pinned_by, pinned_at)
SELECT
  m.id,
  m.conversation_id,
  COALESCE(
    CASE
      WHEN COALESCE(m.metadata ->> 'pinnedBy', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (m.metadata ->> 'pinnedBy')::uuid
      ELSE NULL
    END,
    m.sender_id,
    (
      SELECT cp.user_id
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = m.conversation_id
      ORDER BY cp.joined_at, cp.user_id
      LIMIT 1
    )
  ),
  CASE
    WHEN COALESCE(m.metadata ->> 'pinnedAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
    THEN (m.metadata ->> 'pinnedAt')::timestamptz
    ELSE m.created_at
  END
FROM public.messages m
WHERE COALESCE(m.metadata ->> 'pinned', 'false') = 'true'
  AND COALESCE(
    CASE
      WHEN COALESCE(m.metadata ->> 'pinnedBy', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (m.metadata ->> 'pinnedBy')::uuid
      ELSE NULL
    END,
    m.sender_id,
    (
      SELECT cp.user_id
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = m.conversation_id
      ORDER BY cp.joined_at, cp.user_id
      LIMIT 1
    )
  ) IS NOT NULL
ON CONFLICT (message_id) DO NOTHING;
--> statement-breakpoint

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      btrim(regexp_replace(
        coalesce(content, '')
          || ' ' || coalesce(metadata #>> '{structured,title}', '')
          || ' ' || coalesce(metadata #>> '{structured,summary}', ''),
        '\s+',
        ' ',
        'g'
      ))
    )
  ) STORED;
--> statement-breakpoint

DROP INDEX IF EXISTS public.messages_content_search_idx;
CREATE INDEX messages_content_search_idx
  ON public.messages USING gin (search_document);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS messages_conversation_created_id_idx
  ON public.messages (conversation_id, created_at DESC, id DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS conversation_participants_active_inbox_idx
  ON public.conversation_participants (user_id, last_message_at DESC, conversation_id DESC)
  WHERE archived_at IS NULL AND last_message_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Normalize workflow/work-link identities
-- ---------------------------------------------------------------------------
ALTER TABLE public.message_workflow_items
  ADD COLUMN IF NOT EXISTS role_id uuid;
--> statement-breakpoint

UPDATE public.message_workflow_items
SET role_id = (payload ->> 'roleId')::uuid
WHERE role_id IS NULL
  AND COALESCE(payload ->> 'roleId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
--> statement-breakpoint

DO $workflow_role_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_workflow_items_role_id_project_open_roles_id_fk'
      AND conrelid = 'public.message_workflow_items'::regclass
  ) THEN
    ALTER TABLE public.message_workflow_items
      ADD CONSTRAINT message_workflow_items_role_id_project_open_roles_id_fk
      FOREIGN KEY (role_id) REFERENCES public.project_open_roles(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$workflow_role_fk$;
--> statement-breakpoint

ALTER TABLE public.message_workflow_items
  VALIDATE CONSTRAINT message_workflow_items_role_id_project_open_roles_id_fk;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS message_workflow_items_role_idx
  ON public.message_workflow_items (role_id);
WITH ranked_invites AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        project_id,
        assignee_user_id,
        COALESCE(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.message_workflow_items
  WHERE kind = 'project_invite' AND status = 'pending'
)
UPDATE public.message_workflow_items workflow
SET status = 'canceled', resolved_at = now(), updated_at = now()
FROM ranked_invites ranked
WHERE workflow.id = ranked.id
  AND ranked.row_number > 1;
WITH ranked_follow_ups AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY message_id, creator_id
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.message_workflow_items
  WHERE kind = 'follow_up' AND scope = 'private' AND status = 'pending'
)
UPDATE public.message_workflow_items workflow
SET status = 'canceled', resolved_at = now(), updated_at = now()
FROM ranked_follow_ups ranked
WHERE workflow.id = ranked.id
  AND ranked.row_number > 1;
DROP INDEX IF EXISTS public.message_workflow_items_pending_project_invite_unique;
CREATE UNIQUE INDEX message_workflow_items_pending_project_invite_unique
  ON public.message_workflow_items (
    project_id,
    assignee_user_id,
    COALESCE(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE kind = 'project_invite' AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS message_workflow_items_pending_private_follow_up_unique
  ON public.message_workflow_items (message_id, creator_id)
  WHERE kind = 'follow_up' AND scope = 'private' AND status = 'pending';
--> statement-breakpoint

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY source_message_id, target_type, target_id
      ORDER BY (deleted_at IS NULL) DESC, updated_at DESC, created_at DESC, id DESC
    ) AS row_number
  FROM public.message_work_links
)
DELETE FROM public.message_work_links link
USING ranked
WHERE link.id = ranked.id
  AND ranked.row_number > 1;
--> statement-breakpoint

DROP INDEX IF EXISTS public.message_work_links_source_target_unique;
CREATE UNIQUE INDEX message_work_links_source_target_unique
  ON public.message_work_links (source_message_id, target_type, target_id);
UPDATE public.message_work_links link
SET status = 'unavailable', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
WHERE link.target_type = 'task'
  AND NOT EXISTS (
    SELECT 1
    FROM public.tasks task
    WHERE task.id = link.target_id
      AND task.project_id = link.target_project_id
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.nb_validate_message_work_link_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  task_project_id uuid;
BEGIN
  IF NEW.target_type = 'task' THEN
    SELECT task.project_id
    INTO task_project_id
    FROM public.tasks task
    WHERE task.id = NEW.target_id;

    IF task_project_id IS NULL
      OR NEW.target_project_id IS NULL
      OR task_project_id <> NEW.target_project_id
    THEN
      RAISE EXCEPTION 'Message work-link task/project mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.nb_validate_message_work_link_target() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_work_links_validate_target ON public.message_work_links;
CREATE TRIGGER message_work_links_validate_target
BEFORE INSERT OR UPDATE OF target_type, target_id, target_project_id
ON public.message_work_links
FOR EACH ROW
EXECUTE FUNCTION app_private.nb_validate_message_work_link_target();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Repair derived participant state before constraints are tightened
-- ---------------------------------------------------------------------------
WITH latest AS (
  SELECT
    cp.id AS participant_id,
    m.id AS message_id,
    m.created_at AS message_at,
    m.sender_id,
    COALESCE(NULLIF(m.metadata #>> '{structured,kind}', ''), m.type, 'text') AS preview_type,
    CASE
      WHEN jsonb_typeof(m.metadata -> 'structured') = 'object' THEN COALESCE(
        NULLIF(left(regexp_replace(COALESCE(m.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
        NULLIF(left(regexp_replace(COALESCE(m.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
        'Workflow update'
      )
      WHEN NULLIF(btrim(COALESCE(m.content, '')), '') IS NOT NULL
        THEN left(regexp_replace(COALESCE(m.content, ''), '\s+', ' ', 'g'), 160)
      WHEN m.type = 'image' THEN 'Photo'
      WHEN m.type = 'video' THEN 'Video'
      WHEN m.type = 'file' THEN 'Attachment'
      WHEN m.type = 'system' THEN 'System update'
      ELSE 'Message'
    END AS preview_text
  FROM public.conversation_participants cp
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.messages candidate
    WHERE candidate.conversation_id = cp.conversation_id
      AND candidate.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.message_hidden_for_users hidden
        WHERE hidden.message_id = candidate.id
          AND hidden.user_id = cp.user_id
      )
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) m ON true
)
UPDATE public.conversation_participants cp
SET
  last_message_id = latest.message_id,
  last_message_at = latest.message_at,
  last_message_sender_id = latest.sender_id,
  last_message_preview = latest.preview_text,
  last_message_type = latest.preview_type
FROM latest
WHERE latest.participant_id = cp.id;
--> statement-breakpoint

UPDATE public.conversation_participants cp
SET unread_count = (
  SELECT count(*)::integer
  FROM public.messages m
  WHERE m.conversation_id = cp.conversation_id
    AND m.deleted_at IS NULL
    AND m.sender_id IS DISTINCT FROM cp.user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_hidden_for_users hidden
      WHERE hidden.message_id = m.id
        AND hidden.user_id = cp.user_id
    )
    AND (
      cp.last_read_at IS NULL
      OR (m.created_at, m.id) > (
        cp.last_read_at,
        COALESCE(cp.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    )
);
--> statement-breakpoint

UPDATE public.message_reports report
SET conversation_id = message.conversation_id
FROM public.messages message
WHERE message.id = report.message_id
  AND report.conversation_id IS NULL;
--> statement-breakpoint

ALTER TABLE public.message_attachments
  ALTER COLUMN url DROP NOT NULL;
--> statement-breakpoint

UPDATE public.message_attachments
SET
  url = NULL,
  thumbnail_url = CASE
    WHEN thumbnail_url LIKE '%/object/sign/%'
      OR thumbnail_url LIKE '%token=%'
      OR thumbnail_url LIKE '%signature=%'
    THEN NULL
    ELSE thumbnail_url
  END
WHERE storage_path IS NOT NULL
  AND (
    url LIKE '%/object/sign/%'
    OR url LIKE '%token=%'
    OR url LIKE '%signature=%'
  );
UPDATE public.message_attachments
SET
  filename = COALESCE(NULLIF(left(btrim(filename), 255), ''), 'attachment'),
  size_bytes = CASE
    WHEN size_bytes BETWEEN 0 AND 1073741824 THEN size_bytes
    ELSE NULL
  END,
  width = CASE WHEN width > 0 THEN width ELSE NULL END,
  height = CASE WHEN height > 0 THEN height ELSE NULL END;
--> statement-breakpoint

UPDATE public.attachment_uploads
SET status = 'expired', updated_at = now(), error = COALESCE(error, 'Upload expired before commit')
WHERE expires_at < now()
  AND status IN ('queued', 'uploading', 'uploaded');
--> statement-breakpoint

UPDATE public.message_workflow_items
SET resolved_at = COALESCE(resolved_at, updated_at, created_at)
WHERE status <> 'pending'
  AND resolved_at IS NULL;
UPDATE public.message_workflow_items
SET resolved_at = NULL
WHERE status = 'pending'
  AND resolved_at IS NOT NULL;
UPDATE public.messages
SET type = 'text'
WHERE type IS NULL;
UPDATE public.messages
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;
UPDATE public.conversation_participants
SET muted = false
WHERE muted IS NULL;
--> statement-breakpoint

SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Native cross-row and value invariants
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_unread_non_negative_check,
  ADD CONSTRAINT conversation_participants_unread_non_negative_check
    CHECK (unread_count >= 0) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_type_check,
  ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'system')) NOT VALID,
  DROP CONSTRAINT IF EXISTS messages_client_message_id_check,
  ADD CONSTRAINT messages_client_message_id_check
    CHECK (client_message_id IS NULL OR length(btrim(client_message_id)) BETWEEN 1 AND 160) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.message_workflow_items
  DROP CONSTRAINT IF EXISTS message_workflow_items_kind_check,
  ADD CONSTRAINT message_workflow_items_kind_check
    CHECK (kind IN ('project_invite', 'feedback_request', 'availability_request', 'task_approval', 'follow_up')) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_workflow_items_scope_check,
  ADD CONSTRAINT message_workflow_items_scope_check
    CHECK (scope IN ('conversation', 'private')) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_workflow_items_status_check,
  ADD CONSTRAINT message_workflow_items_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'needs_changes', 'canceled', 'expired')) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_workflow_items_resolution_check,
  ADD CONSTRAINT message_workflow_items_resolution_check
    CHECK (
      (status = 'pending' AND resolved_at IS NULL)
      OR (status <> 'pending' AND resolved_at IS NOT NULL)
    ) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.attachment_uploads
  DROP CONSTRAINT IF EXISTS attachment_uploads_client_upload_id_check,
  ADD CONSTRAINT attachment_uploads_client_upload_id_check
    CHECK (length(btrim(client_upload_id)) BETWEEN 1 AND 160) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachment_uploads_status_check,
  ADD CONSTRAINT attachment_uploads_status_check
    CHECK (status IN ('queued', 'uploading', 'uploaded', 'committed', 'failed', 'canceled', 'expired')) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachment_uploads_expiry_check,
  ADD CONSTRAINT attachment_uploads_expiry_check
    CHECK (expires_at IS NULL OR expires_at > created_at) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachment_uploads_size_check,
  ADD CONSTRAINT attachment_uploads_size_check
    CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 1073741824) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachment_uploads_storage_state_check,
  ADD CONSTRAINT attachment_uploads_storage_state_check
    CHECK (status NOT IN ('uploaded', 'committed') OR NULLIF(btrim(storage_path), '') IS NOT NULL) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_type_check,
  ADD CONSTRAINT message_attachments_type_check
    CHECK (type IN ('image', 'video', 'file')) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_attachments_filename_check,
  ADD CONSTRAINT message_attachments_filename_check
    CHECK (length(btrim(filename)) BETWEEN 1 AND 255) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_attachments_size_check,
  ADD CONSTRAINT message_attachments_size_check
    CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 1073741824) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_attachments_dimensions_check,
  ADD CONSTRAINT message_attachments_dimensions_check
    CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)) NOT VALID,
  DROP CONSTRAINT IF EXISTS message_attachments_storage_reference_check,
  ADD CONSTRAINT message_attachments_storage_reference_check
    CHECK (NULLIF(btrim(storage_path), '') IS NOT NULL OR NULLIF(btrim(url), '') IS NOT NULL) NOT VALID;
--> statement-breakpoint

DO $same_conversation_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_participants_last_read_message_conversation_fkey'
      AND conrelid = 'public.conversation_participants'::regclass
  ) THEN
    ALTER TABLE public.conversation_participants
      ADD CONSTRAINT conversation_participants_last_read_message_conversation_fkey
      FOREIGN KEY (last_read_message_id, conversation_id)
      REFERENCES public.messages(id, conversation_id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_participants_last_message_conversation_fkey'
      AND conrelid = 'public.conversation_participants'::regclass
  ) THEN
    ALTER TABLE public.conversation_participants
      ADD CONSTRAINT conversation_participants_last_message_conversation_fkey
      FOREIGN KEY (last_message_id, conversation_id)
      REFERENCES public.messages(id, conversation_id)
      NOT VALID;
  END IF;

  ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_reply_to_message_id_fkey;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_reply_to_message_conversation_fkey'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_reply_to_message_conversation_fkey
      FOREIGN KEY (reply_to_message_id, conversation_id)
      REFERENCES public.messages(id, conversation_id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_workflow_items_message_conversation_fkey'
      AND conrelid = 'public.message_workflow_items'::regclass
  ) THEN
    ALTER TABLE public.message_workflow_items
      ADD CONSTRAINT message_workflow_items_message_conversation_fkey
      FOREIGN KEY (message_id, conversation_id)
      REFERENCES public.messages(id, conversation_id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'message_work_links_source_message_conversation_fkey'
      AND conrelid = 'public.message_work_links'::regclass
  ) THEN
    ALTER TABLE public.message_work_links
      ADD CONSTRAINT message_work_links_source_message_conversation_fkey
      FOREIGN KEY (source_message_id, source_conversation_id)
      REFERENCES public.messages(id, conversation_id)
      NOT VALID;
  END IF;
END
$same_conversation_constraints$;
--> statement-breakpoint

ALTER TABLE public.conversation_participants
  VALIDATE CONSTRAINT conversation_participants_unread_non_negative_check,
  VALIDATE CONSTRAINT conversation_participants_last_read_message_conversation_fkey,
  VALIDATE CONSTRAINT conversation_participants_last_message_conversation_fkey;
ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_type_check,
  VALIDATE CONSTRAINT messages_client_message_id_check,
  VALIDATE CONSTRAINT messages_reply_to_message_conversation_fkey;
ALTER TABLE public.message_workflow_items
  VALIDATE CONSTRAINT message_workflow_items_kind_check,
  VALIDATE CONSTRAINT message_workflow_items_scope_check,
  VALIDATE CONSTRAINT message_workflow_items_status_check,
  VALIDATE CONSTRAINT message_workflow_items_resolution_check,
  VALIDATE CONSTRAINT message_workflow_items_message_conversation_fkey;
ALTER TABLE public.message_work_links
  VALIDATE CONSTRAINT message_work_links_source_message_conversation_fkey;
ALTER TABLE public.attachment_uploads
  VALIDATE CONSTRAINT attachment_uploads_client_upload_id_check,
  VALIDATE CONSTRAINT attachment_uploads_status_check,
  VALIDATE CONSTRAINT attachment_uploads_expiry_check,
  VALIDATE CONSTRAINT attachment_uploads_size_check,
  VALIDATE CONSTRAINT attachment_uploads_storage_state_check;
ALTER TABLE public.message_attachments
  VALIDATE CONSTRAINT message_attachments_type_check,
  VALIDATE CONSTRAINT message_attachments_filename_check,
  VALIDATE CONSTRAINT message_attachments_size_check,
  VALIDATE CONSTRAINT message_attachments_dimensions_check,
  VALIDATE CONSTRAINT message_attachments_storage_reference_check;
--> statement-breakpoint

ALTER TABLE public.message_reports
  ALTER COLUMN conversation_id SET NOT NULL;
ALTER TABLE public.messages
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN metadata SET NOT NULL;
ALTER TABLE public.conversation_participants
  ALTER COLUMN muted SET NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Monotonic inbox projection trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_message_insert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preview_text text;
  preview_type text;
  zero_uuid constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  preview_text := CASE
    WHEN jsonb_typeof(NEW.metadata -> 'structured') = 'object' THEN COALESCE(
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
      'Workflow update'
    )
    WHEN NULLIF(btrim(COALESCE(NEW.content, '')), '') IS NOT NULL
      THEN left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 160)
    WHEN NEW.type = 'image' THEN 'Photo'
    WHEN NEW.type = 'video' THEN 'Video'
    WHEN NEW.type = 'file' THEN 'Attachment'
    WHEN NEW.type = 'system' THEN 'System update'
    ELSE 'Message'
  END;
  preview_type := COALESCE(NULLIF(NEW.metadata #>> '{structured,kind}', ''), NEW.type, 'text');

  UPDATE public.conversations
  SET updated_at = GREATEST(updated_at, NEW.created_at)
  WHERE id = NEW.conversation_id;

  UPDATE public.conversation_participants
  SET
    unread_count = unread_count + CASE
      WHEN last_read_at IS NULL
        OR (NEW.created_at, NEW.id) > (
          last_read_at,
          COALESCE(last_read_message_id, zero_uuid)
        )
      THEN 1
      ELSE 0
    END,
    last_message_at = CASE
      WHEN last_message_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
      THEN NEW.created_at ELSE last_message_at END,
    last_message_id = CASE
      WHEN last_message_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
      THEN NEW.id ELSE last_message_id END,
    last_message_preview = CASE
      WHEN last_message_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
      THEN preview_text ELSE last_message_preview END,
    last_message_type = CASE
      WHEN last_message_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
      THEN preview_type ELSE last_message_type END,
    last_message_sender_id = CASE
      WHEN last_message_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
      THEN NEW.sender_id ELSE last_message_sender_id END,
    archived_at = CASE
      WHEN last_message_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
      THEN NULL ELSE archived_at END
  WHERE conversation_id = NEW.conversation_id
    AND (NEW.sender_id IS NULL OR user_id <> NEW.sender_id);

  IF NEW.sender_id IS NOT NULL THEN
    UPDATE public.conversation_participants
    SET
      unread_count = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) >= (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN 0 ELSE unread_count END,
      last_read_at = CASE
        WHEN last_read_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_read_at, COALESCE(last_read_message_id, zero_uuid))
        THEN NEW.created_at ELSE last_read_at END,
      last_read_message_id = CASE
        WHEN last_read_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_read_at, COALESCE(last_read_message_id, zero_uuid))
        THEN NEW.id ELSE last_read_message_id END,
      last_message_at = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN NEW.created_at ELSE last_message_at END,
      last_message_id = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN NEW.id ELSE last_message_id END,
      last_message_preview = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN preview_text ELSE last_message_preview END,
      last_message_type = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN preview_type ELSE last_message_type END,
      last_message_sender_id = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN NEW.sender_id ELSE last_message_sender_id END,
      archived_at = CASE
        WHEN last_message_at IS NULL
          OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid))
        THEN NULL ELSE archived_at END
    WHERE conversation_id = NEW.conversation_id
      AND user_id = NEW.sender_id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.handle_message_insert_consistency() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.nb_reconcile_conversation_participants(
  p_conversation_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  WITH target AS (
    SELECT
      cp.id,
      cp.user_id,
      cp.last_read_at,
      cp.last_read_message_id
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND (p_user_id IS NULL OR cp.user_id = p_user_id)
    FOR UPDATE
  ),
  calculated AS (
    SELECT
      target.id,
      latest.id AS last_message_id,
      latest.created_at AS last_message_at,
      latest.sender_id AS last_message_sender_id,
      COALESCE(NULLIF(latest.metadata #>> '{structured,kind}', ''), latest.type, 'text') AS last_message_type,
      CASE
        WHEN latest.id IS NULL THEN NULL
        WHEN jsonb_typeof(latest.metadata -> 'structured') = 'object' THEN COALESCE(
          NULLIF(left(regexp_replace(COALESCE(latest.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
          NULLIF(left(regexp_replace(COALESCE(latest.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
          'Workflow update'
        )
        WHEN NULLIF(btrim(COALESCE(latest.content, '')), '') IS NOT NULL
          THEN left(regexp_replace(COALESCE(latest.content, ''), '\s+', ' ', 'g'), 160)
        WHEN latest.type = 'image' THEN 'Photo'
        WHEN latest.type = 'video' THEN 'Video'
        WHEN latest.type = 'file' THEN 'Attachment'
        WHEN latest.type = 'system' THEN 'System update'
        ELSE 'Message'
      END AS last_message_preview,
      (
        SELECT count(*)::integer
        FROM public.messages unread_message
        WHERE unread_message.conversation_id = p_conversation_id
          AND unread_message.deleted_at IS NULL
          AND unread_message.sender_id IS DISTINCT FROM target.user_id
          AND (
            target.last_read_at IS NULL
            OR (unread_message.created_at, unread_message.id) > (
              target.last_read_at,
              COALESCE(
                target.last_read_message_id,
                '00000000-0000-0000-0000-000000000000'::uuid
              )
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.message_hidden_for_users hidden
            WHERE hidden.message_id = unread_message.id
              AND hidden.user_id = target.user_id
          )
      ) AS unread_count
    FROM target
    LEFT JOIN LATERAL (
      SELECT message.*
      FROM public.messages message
      WHERE message.conversation_id = p_conversation_id
        AND message.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.message_hidden_for_users hidden
          WHERE hidden.message_id = message.id
            AND hidden.user_id = target.user_id
        )
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 1
    ) latest ON true
  )
  UPDATE public.conversation_participants participant
  SET
    unread_count = calculated.unread_count,
    last_message_id = calculated.last_message_id,
    last_message_at = calculated.last_message_at,
    last_message_sender_id = calculated.last_message_sender_id,
    last_message_type = calculated.last_message_type,
    last_message_preview = calculated.last_message_preview
  FROM calculated
  WHERE participant.id = calculated.id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.nb_reconcile_conversation_participants(uuid, uuid)
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Browser roles are read-only; server actions own every messaging mutation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $drop_messaging_policies$
DECLARE
  target_table text;
  policy_record record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'conversations',
    'conversation_participants',
    'dm_pairs',
    'messages',
    'message_attachments',
    'message_hidden_for_users',
    'message_edit_logs',
    'attachment_uploads',
    'message_reactions',
    'message_reports',
    'message_read_receipts',
    'message_delivery_receipts',
    'message_workflow_items',
    'message_work_links',
    'message_pins',
    'role_applications',
    'application_events'
  ]
  LOOP
    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_record.policyname, target_table);
    END LOOP;
  END LOOP;
END
$drop_messaging_policies$;
--> statement-breakpoint

CREATE POLICY conversations_member_select
ON public.conversations FOR SELECT TO authenticated
USING (app_private.nb_is_conversation_participant(id));

CREATE POLICY conversation_participants_member_select
ON public.conversation_participants FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR app_private.nb_is_conversation_participant(conversation_id)
);

CREATE POLICY dm_pairs_member_select
ON public.dm_pairs FOR SELECT TO authenticated
USING (user_low = (SELECT auth.uid()) OR user_high = (SELECT auth.uid()));

CREATE POLICY messages_member_select
ON public.messages FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND app_private.nb_is_conversation_participant(conversation_id)
);

CREATE POLICY message_attachments_member_select
ON public.message_attachments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.messages message
    WHERE message.id = message_attachments.message_id
      AND app_private.nb_is_conversation_participant(message.conversation_id)
  )
);

CREATE POLICY message_hidden_owner_select
ON public.message_hidden_for_users FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.messages message
    WHERE message.id = message_hidden_for_users.message_id
      AND app_private.nb_is_conversation_participant(message.conversation_id)
  )
);

CREATE POLICY message_edit_logs_member_select
ON public.message_edit_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.messages message
    WHERE message.id = message_edit_logs.message_id
      AND app_private.nb_is_conversation_participant(message.conversation_id)
  )
);

CREATE POLICY attachment_uploads_owner_select
ON public.attachment_uploads FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY message_reactions_member_select
ON public.message_reactions FOR SELECT TO authenticated
USING (app_private.nb_is_conversation_participant(conversation_id));

CREATE POLICY message_reports_owner_select
ON public.message_reports FOR SELECT TO authenticated
USING (reporter_id = (SELECT auth.uid()));

CREATE POLICY message_read_receipts_member_select
ON public.message_read_receipts FOR SELECT TO authenticated
USING (app_private.nb_is_conversation_participant(conversation_id));

CREATE POLICY message_delivery_receipts_member_select
ON public.message_delivery_receipts FOR SELECT TO authenticated
USING (app_private.nb_is_conversation_participant(conversation_id));

CREATE POLICY message_workflow_items_member_select
ON public.message_workflow_items FOR SELECT TO authenticated
USING (
  app_private.nb_is_conversation_participant(conversation_id)
  AND (
    scope = 'conversation'
    OR creator_id = (SELECT auth.uid())
    OR assignee_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY message_work_links_member_select
ON public.message_work_links FOR SELECT TO authenticated
USING (
  app_private.nb_is_conversation_participant(source_conversation_id)
  AND (
    visibility = 'shared'
    OR created_by = (SELECT auth.uid())
    OR owner_user_id = (SELECT auth.uid())
  )
);

CREATE POLICY message_pins_member_select
ON public.message_pins FOR SELECT TO authenticated
USING (app_private.nb_is_conversation_participant(conversation_id));

CREATE POLICY role_applications_actor_select
ON public.role_applications FOR SELECT TO authenticated
USING (
  applicant_id = (SELECT auth.uid())
  OR app_private.nb_project_can_admin(project_id)
);

CREATE POLICY application_events_actor_select
ON public.application_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.role_applications application
    WHERE application.id = application_events.application_id
      AND (
        application.applicant_id = (SELECT auth.uid())
        OR app_private.nb_project_can_admin(application.project_id)
      )
  )
);
--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE
  public.conversations,
  public.conversation_participants,
  public.dm_pairs,
  public.messages,
  public.message_attachments,
  public.message_hidden_for_users,
  public.message_edit_logs,
  public.attachment_uploads,
  public.message_reactions,
  public.message_reports,
  public.message_read_receipts,
  public.message_delivery_receipts,
  public.message_workflow_items,
  public.message_work_links,
  public.message_pins,
  public.role_applications,
  public.application_events
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

GRANT SELECT ON TABLE
  public.conversations,
  public.conversation_participants,
  public.dm_pairs,
  public.messages,
  public.message_attachments,
  public.message_hidden_for_users,
  public.message_edit_logs,
  public.attachment_uploads,
  public.message_reactions,
  public.message_reports,
  public.message_read_receipts,
  public.message_delivery_receipts,
  public.message_workflow_items,
  public.message_work_links,
  public.message_pins,
  public.role_applications,
  public.application_events
TO authenticated;
