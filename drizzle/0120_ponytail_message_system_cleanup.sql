-- Ponytail message-system cleanup: remove abandoned messaging structures that
-- were never swapped into the runtime path.
--
-- Historical migrations remain append-only; this migration drops runtime-unused
-- copies/columns if they exist in an upgraded database.

ALTER TABLE IF EXISTS "conversation_participants"
    DROP COLUMN IF EXISTS "pinned_at";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'typing_indicators'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.typing_indicators;
    END IF;
END $$;

DROP FUNCTION IF EXISTS cleanup_old_typing_indicators();
DROP TABLE IF EXISTS "typing_indicators" CASCADE;

DROP TABLE IF EXISTS "messages_partitioned" CASCADE;
DROP TABLE IF EXISTS "messages_p0" CASCADE;
DROP TABLE IF EXISTS "messages_p1" CASCADE;
DROP TABLE IF EXISTS "messages_p2" CASCADE;
DROP TABLE IF EXISTS "messages_p3" CASCADE;
DROP TABLE IF EXISTS "messages_p4" CASCADE;
DROP TABLE IF EXISTS "messages_p5" CASCADE;
DROP TABLE IF EXISTS "messages_p6" CASCADE;
DROP TABLE IF EXISTS "messages_p7" CASCADE;
DROP TABLE IF EXISTS "messages_p8" CASCADE;
DROP TABLE IF EXISTS "messages_p9" CASCADE;
DROP TABLE IF EXISTS "messages_p10" CASCADE;
DROP TABLE IF EXISTS "messages_p11" CASCADE;
DROP TABLE IF EXISTS "messages_p12" CASCADE;
DROP TABLE IF EXISTS "messages_p13" CASCADE;
DROP TABLE IF EXISTS "messages_p14" CASCADE;
DROP TABLE IF EXISTS "messages_p15" CASCADE;
