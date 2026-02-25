ALTER TABLE onboarding_submissions
ADD COLUMN IF NOT EXISTS claims_repaired_at timestamptz;

CREATE INDEX IF NOT EXISTS onboarding_submissions_repair_queue_idx
ON onboarding_submissions (status, claims_repaired_at, updated_at);
