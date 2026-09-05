CREATE TABLE IF NOT EXISTS "legal_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "terms_version" text NOT NULL,
  "eula_version" text NOT NULL,
  "privacy_notice_version" text NOT NULL,
  "context" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retention_expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "legal_acceptances_user_versions_unique" UNIQUE("user_id", "terms_version", "eula_version", "privacy_notice_version")
);

CREATE INDEX IF NOT EXISTS "legal_acceptances_user_accepted_idx"
ON "legal_acceptances" ("user_id", "accepted_at");

CREATE INDEX IF NOT EXISTS "legal_acceptances_expiry_idx"
ON "legal_acceptances" ("retention_expires_at");

ALTER TABLE "legal_acceptances" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "legal_acceptances" FROM anon, authenticated;

ALTER TABLE "account_deletions"
ADD COLUMN IF NOT EXISTS "legal_retention_until" timestamp with time zone;

UPDATE "account_deletions"
SET "legal_retention_until" = "hard_delete_at" + interval '150 days'
WHERE "legal_retention_until" IS NULL;

ALTER TABLE "account_deletions"
ALTER COLUMN "legal_retention_until" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "account_deletions_legal_retention_idx"
ON "account_deletions" ("legal_retention_until", "completed_at");
