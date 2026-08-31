-- A reaction is activity about a message, not a replacement message. Keep a
-- small recipient-specific projection for inbox copy without changing message
-- chronology, ordering, or unread counts.
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS last_reaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reaction_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_reaction_emoji text,
  ADD COLUMN IF NOT EXISTS last_reaction_actor_id uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.conversation_participants
    ADD CONSTRAINT conversation_participants_last_reaction_message_conversation_fkey
    FOREIGN KEY (last_reaction_message_id, conversation_id)
    REFERENCES public.messages (id, conversation_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.conversation_participants
    ADD CONSTRAINT conversation_participants_last_reaction_actor_fkey
    FOREIGN KEY (last_reaction_actor_id)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- WhatsApp-style semantics are one current reaction per actor/message. Keep
-- the newest historical reaction when repairing rows created by the old
-- per-emoji uniqueness constraint.
WITH ranked_reactions AS (
  SELECT id, row_number() OVER (
    PARTITION BY message_id, user_id
    ORDER BY created_at DESC, id DESC
  ) AS row_number
  FROM public.message_reactions
)
DELETE FROM public.message_reactions reaction
USING ranked_reactions ranked
WHERE reaction.id = ranked.id AND ranked.row_number > 1;
--> statement-breakpoint

DROP INDEX IF EXISTS public.message_reactions_message_user_emoji_unique;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_message_user_unique
  ON public.message_reactions (message_id, user_id);
