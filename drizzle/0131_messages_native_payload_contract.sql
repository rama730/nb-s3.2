-- Preserve legacy metadata without permitting scalar/array JSON in new rows.
UPDATE public.messages
SET metadata = jsonb_build_object('legacyValue', metadata)
WHERE jsonb_typeof(metadata) IS DISTINCT FROM 'object';
--> statement-breakpoint

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_metadata_object_check,
  ADD CONSTRAINT messages_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object') NOT VALID,
  DROP CONSTRAINT IF EXISTS messages_content_length_check,
  ADD CONSTRAINT messages_content_length_check
    CHECK (content IS NULL OR char_length(content) <= 4000) NOT VALID,
  DROP CONSTRAINT IF EXISTS messages_system_idempotency_check,
  ADD CONSTRAINT messages_system_idempotency_check
    CHECK (sender_id IS NOT NULL OR client_message_id IS NULL) NOT VALID,
  DROP CONSTRAINT IF EXISTS messages_active_payload_check,
  ADD CONSTRAINT messages_active_payload_check
    CHECK (
      deleted_at IS NOT NULL
      OR type <> 'text'
      OR NULLIF(btrim(COALESCE(content, '')), '') IS NOT NULL
      OR jsonb_typeof(metadata -> 'structured') = 'object'
    ) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_metadata_object_check,
  VALIDATE CONSTRAINT messages_content_length_check,
  VALIDATE CONSTRAINT messages_system_idempotency_check,
  VALIDATE CONSTRAINT messages_active_payload_check;
--> statement-breakpoint

ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_last_message_sender_fkey,
  ADD CONSTRAINT conversation_participants_last_message_sender_fkey
    FOREIGN KEY (last_message_sender_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL
    NOT VALID;
--> statement-breakpoint

ALTER TABLE public.conversation_participants
  VALIDATE CONSTRAINT conversation_participants_last_message_sender_fkey;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS conversation_participants_last_message_sender_idx
  ON public.conversation_participants (last_message_sender_id);
