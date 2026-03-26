CREATE TABLE IF NOT EXISTS "username_aliases" (
	"username" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "username_aliases"
ADD CONSTRAINT "username_aliases_user_id_profiles_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "username_aliases_user_primary_idx"
ON "username_aliases" USING btree ("user_id","is_primary");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "username_aliases_user_claimed_at_idx"
ON "username_aliases" USING btree ("user_id","claimed_at");
--> statement-breakpoint

INSERT INTO "username_aliases" ("username", "user_id", "is_primary", "claimed_at", "replaced_at")
SELECT
	"username",
	"id",
	true,
	COALESCE("created_at", now()),
	NULL
FROM "profiles"
WHERE "username" IS NOT NULL
ON CONFLICT ("username") DO UPDATE
SET
	"user_id" = EXCLUDED."user_id",
	"is_primary" = EXCLUDED."is_primary",
	"replaced_at" = NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS "profiles_username_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "profiles_username_lower_unique_idx";
