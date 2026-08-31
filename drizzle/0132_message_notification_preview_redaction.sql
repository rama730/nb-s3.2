-- Message alerts are delivery signals, not a second durable copy of message text.
-- Redact old previews so an unsent message cannot remain visible in the bell.
UPDATE public.user_notifications
SET body = NULL
WHERE kind = 'message_burst' AND body IS NOT NULL;
