CREATE TABLE IF NOT EXISTS "upload_intents" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "project_id" uuid,
    "bucket" text NOT NULL,
    "storage_key" text NOT NULL,
    "scope" text NOT NULL,
    "kind" text NOT NULL,
    "expected_mime_type" text NOT NULL,
    "expected_size" bigint NOT NULL,
    "finalized_mime_type" text,
    "finalized_size" bigint,
    "status" text DEFAULT 'pending' NOT NULL,
    "failure_reason" text,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "expires_at" timestamptz NOT NULL,
    "finalized_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "upload_intents"
    ADD CONSTRAINT "upload_intents_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade
    ON UPDATE no action;

ALTER TABLE "upload_intents"
    ADD CONSTRAINT "upload_intents_project_id_projects_id_fk"
    FOREIGN KEY ("project_id")
    REFERENCES "public"."projects"("id")
    ON DELETE cascade
    ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "upload_intents_bucket_key_uidx"
    ON "upload_intents" ("bucket", "storage_key");

CREATE INDEX IF NOT EXISTS "upload_intents_user_idx"
    ON "upload_intents" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "upload_intents_project_idx"
    ON "upload_intents" ("project_id", "created_at");

CREATE INDEX IF NOT EXISTS "upload_intents_status_expires_idx"
    ON "upload_intents" ("status", "expires_at");

ALTER TABLE "upload_intents" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own upload intents" ON "upload_intents";
CREATE POLICY "Users can view own upload intents"
    ON "upload_intents"
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own upload intents" ON "upload_intents";
CREATE POLICY "Users can create own upload intents"
    ON "upload_intents"
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own upload intents" ON "upload_intents";
CREATE POLICY "Users can update own upload intents"
    ON "upload_intents"
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS "recovery_code_redemptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "code_id" text NOT NULL,
    "redeemed_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "recovery_code_redemptions"
    ADD CONSTRAINT "recovery_code_redemptions_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade
    ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_code_redemptions_user_code_uidx"
    ON "recovery_code_redemptions" ("user_id", "code_id");

CREATE INDEX IF NOT EXISTS "recovery_code_redemptions_user_redeemed_idx"
    ON "recovery_code_redemptions" ("user_id", "redeemed_at");

ALTER TABLE "recovery_code_redemptions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own recovery code redemptions" ON "recovery_code_redemptions";
CREATE POLICY "Users can view own recovery code redemptions"
    ON "recovery_code_redemptions"
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own recovery code redemptions" ON "recovery_code_redemptions";
CREATE POLICY "Users can create own recovery code redemptions"
    ON "recovery_code_redemptions"
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
