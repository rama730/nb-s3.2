-- Repair inbox previews written before structured-message sends refreshed the
-- denormalized participant projection in application code.
DO $backfill_structured_message_previews$
DECLARE conversation_record record;
BEGIN
  FOR conversation_record IN
    SELECT DISTINCT conversation_id FROM public.conversation_participants
  LOOP
    PERFORM app_private.nb_reconcile_conversation_participants(conversation_record.conversation_id, NULL);
  END LOOP;
END
$backfill_structured_message_previews$;
