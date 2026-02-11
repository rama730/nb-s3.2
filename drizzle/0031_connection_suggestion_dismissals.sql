CREATE TABLE IF NOT EXISTS "connection_suggestion_dismissals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "dismissed_profile_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "connection_suggestion_dismissals"
    ADD CONSTRAINT "connection_suggestion_dismissals_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connection_suggestion_dismissals"
    ADD CONSTRAINT "connection_suggestion_dismissals_dismissed_profile_id_profiles_id_fk"
    FOREIGN KEY ("dismissed_profile_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "connection_suggestion_dismissals_user_profile_uidx"
    ON "connection_suggestion_dismissals" USING btree ("user_id","dismissed_profile_id");

CREATE INDEX IF NOT EXISTS "connection_suggestion_dismissals_user_created_idx"
    ON "connection_suggestion_dismissals" USING btree ("user_id","created_at");
