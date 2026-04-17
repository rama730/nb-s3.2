CREATE TABLE IF NOT EXISTS "profile_security_states" (
    "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."profiles"("id") ON DELETE cascade,
    "security_recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "recovery_codes_generated_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_security_states_generated_at_idx"
    ON "profile_security_states" USING btree ("recovery_codes_generated_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'security_recovery_codes'
  ) THEN
    INSERT INTO "profile_security_states" ("user_id", "security_recovery_codes", "recovery_codes_generated_at", "updated_at")
    SELECT
      "id",
      COALESCE("security_recovery_codes", '[]'::jsonb),
      "recovery_codes_generated_at",
      COALESCE("updated_at", now())
    FROM "profiles"
    ON CONFLICT ("user_id") DO UPDATE
      SET "security_recovery_codes" = EXCLUDED."security_recovery_codes",
          "recovery_codes_generated_at" = EXCLUDED."recovery_codes_generated_at",
          "updated_at" = EXCLUDED."updated_at";

    ALTER TABLE "profiles" DROP COLUMN IF EXISTS "security_recovery_codes";
    ALTER TABLE "profiles" DROP COLUMN IF EXISTS "recovery_codes_generated_at";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "profile_security_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view own profile security state" ON "profile_security_states";
CREATE POLICY "Users can view own profile security state"
ON "profile_security_states" FOR SELECT
USING (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can insert own profile security state" ON "profile_security_states";
CREATE POLICY "Users can insert own profile security state"
ON "profile_security_states" FOR INSERT
WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own profile security state" ON "profile_security_states";
CREATE POLICY "Users can update own profile security state"
ON "profile_security_states" FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can delete own profile security state" ON "profile_security_states";
CREATE POLICY "Users can delete own profile security state"
ON "profile_security_states" FOR DELETE
USING (auth.uid() = user_id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON "profiles";
DROP POLICY IF EXISTS "Profiles are viewable by allowed users" ON "profiles";
CREATE POLICY "Profiles are viewable by allowed users"
ON "profiles" FOR SELECT
USING (
  auth.uid() = id
  OR visibility = 'public'
  OR (
    visibility = 'connections'
    AND EXISTS (
      SELECT 1
      FROM "connections" c
      WHERE c.status = 'accepted'
        AND (
          (c.requester_id = auth.uid() AND c.addressee_id = "profiles"."id")
          OR (c.addressee_id = auth.uid() AND c.requester_id = "profiles"."id")
        )
    )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own profile" ON "profiles";
CREATE POLICY "Users can update own profile"
ON "profiles" FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can insert their own messages" ON "messages";
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON "messages";
CREATE POLICY "Users can send messages in their conversations"
ON "messages" FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "conversation_participants" cp
    WHERE cp.conversation_id = "messages".conversation_id
      AND cp.user_id = auth.uid()
  )
);
