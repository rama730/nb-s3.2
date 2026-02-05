-- ============================================================================
-- ROLE APPLICATIONS: message column + integrity constraints
-- Fixes schema drift where application actions write role_applications.message.
-- ============================================================================

-- 1) Add application message column (nullable)
ALTER TABLE role_applications
ADD COLUMN IF NOT EXISTS message TEXT;

-- 2) Enforce one application per (project, applicant) at the DB level
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'role_applications_project_applicant_unique'
  ) THEN
    ALTER TABLE role_applications
      ADD CONSTRAINT role_applications_project_applicant_unique
      UNIQUE (project_id, applicant_id);
  END IF;
END $$;

-- 3) Optionally enforce conversation_id references conversations(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'role_applications_conversation_id_conversations_id_fk'
  ) THEN
    ALTER TABLE role_applications
      ADD CONSTRAINT role_applications_conversation_id_conversations_id_fk
      FOREIGN KEY (conversation_id)
      REFERENCES conversations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

