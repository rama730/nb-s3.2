-- The inbox is a projection of the latest chronological message. An unsent
-- message remains that latest message as a tombstone; otherwise the preview
-- silently regresses to unrelated older content.
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
    SELECT cp.id, cp.user_id, cp.last_read_at, cp.last_read_message_id
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
      projection.preview_type AS last_message_type,
      projection.preview_text AS last_message_preview,
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
              COALESCE(target.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.message_hidden_for_users hidden
            WHERE hidden.message_id = unread_message.id AND hidden.user_id = target.user_id
          )
      ) AS unread_count
    FROM target
    LEFT JOIN LATERAL (
      SELECT message.*
      FROM public.messages message
      WHERE message.conversation_id = p_conversation_id
        AND NOT EXISTS (
          SELECT 1 FROM public.message_hidden_for_users hidden
          WHERE hidden.message_id = message.id AND hidden.user_id = target.user_id
        )
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN latest.id IS NULL THEN NULL
          WHEN latest.deleted_at IS NOT NULL THEN 'deleted'
          ELSE COALESCE(
            NULLIF(latest.metadata #>> '{previewKind}', ''),
            NULLIF(latest.metadata #>> '{structured,kind}', ''),
            latest.type,
            'text'
          )
        END AS preview_type,
        CASE
          WHEN latest.id IS NULL THEN NULL
          WHEN latest.deleted_at IS NOT NULL THEN 'This message was deleted'
          ELSE concat(
            CASE WHEN latest.reply_to_message_id IS NOT NULL THEN '↩ ' ELSE '' END,
            CASE
              WHEN jsonb_typeof(latest.metadata -> 'structured') = 'object' THEN COALESCE(
                NULLIF(left(regexp_replace(COALESCE(latest.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
                NULLIF(left(regexp_replace(COALESCE(latest.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
                'Workflow update'
              )
              WHEN NULLIF(latest.metadata #>> '{previewKind}', '') = 'image' OR latest.type = 'image' THEN 'Photo'
              WHEN NULLIF(latest.metadata #>> '{previewKind}', '') = 'video' OR latest.type = 'video' THEN 'Video'
              WHEN NULLIF(latest.metadata #>> '{previewKind}', '') = 'voice' THEN 'Voice message'
              WHEN NULLIF(latest.metadata #>> '{previewKind}', '') = 'file' OR latest.type = 'file' THEN 'File'
              WHEN latest.type = 'system' THEN 'System update'
              WHEN NULLIF(btrim(COALESCE(latest.content, '')), '') IS NOT NULL
                THEN left(regexp_replace(COALESCE(latest.content, ''), '\s+', ' ', 'g'), 160)
              ELSE 'Message'
            END
          )
        END AS preview_text
    ) projection ON true
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

-- Backfill once so historic unsends and reply/media previews do not wait for a
-- later conversation mutation to become consistent.
DO $backfill_message_preview_lifecycle$
DECLARE conversation_record record;
BEGIN
  FOR conversation_record IN
    SELECT DISTINCT conversation_id FROM public.conversation_participants
  LOOP
    PERFORM app_private.nb_reconcile_conversation_participants(conversation_record.conversation_id, NULL);
  END LOOP;
END
$backfill_message_preview_lifecycle$;
