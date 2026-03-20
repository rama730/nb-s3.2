ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "security_recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
ADD COLUMN IF NOT EXISTS "recovery_codes_generated_at" timestamp with time zone;
