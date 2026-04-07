CREATE TABLE IF NOT EXISTS "connection_suggestions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "suggested_user_id" uuid NOT NULL,
    "mutual_connections_count" integer DEFAULT 0 NOT NULL,
    "score" integer DEFAULT 0 NOT NULL,
    "reason" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "connection_suggestions"
    ADD CONSTRAINT "connection_suggestions_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connection_suggestions"
    ADD CONSTRAINT "connection_suggestions_suggested_user_id_profiles_id_fk"
    FOREIGN KEY ("suggested_user_id")
    REFERENCES "public"."profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "connection_suggestions_user_suggested_uidx"
    ON "connection_suggestions" USING btree ("user_id","suggested_user_id");

CREATE INDEX IF NOT EXISTS "connection_suggestions_user_score_idx"
    ON "connection_suggestions" USING btree ("user_id","score");
