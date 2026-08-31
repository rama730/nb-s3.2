-- Every messaging foreign key needs a matching leading index so deletes,
-- constraint checks, and cascades do not scan the referencing table.
CREATE INDEX IF NOT EXISTS conversation_participants_last_read_message_conversation_idx
  ON public.conversation_participants (last_read_message_id, conversation_id);
CREATE INDEX IF NOT EXISTS conversation_participants_last_message_conversation_idx
  ON public.conversation_participants (last_message_id, conversation_id);
CREATE INDEX IF NOT EXISTS messages_reply_to_message_conversation_idx
  ON public.messages (reply_to_message_id, conversation_id);
CREATE INDEX IF NOT EXISTS message_workflow_items_message_conversation_idx
  ON public.message_workflow_items (message_id, conversation_id);
CREATE INDEX IF NOT EXISTS message_work_links_source_message_conversation_idx
  ON public.message_work_links (source_message_id, source_conversation_id);
CREATE INDEX IF NOT EXISTS message_pins_message_conversation_idx
  ON public.message_pins (message_id, conversation_id);
CREATE INDEX IF NOT EXISTS message_pins_pinned_by_idx
  ON public.message_pins (pinned_by);
