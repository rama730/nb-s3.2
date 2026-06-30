-- Phase 1: Create new tables and add columns within a transaction block

-- 1. Create extension device sessions table
CREATE TABLE IF NOT EXISTS extension_device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  token_prefix text NOT NULL,
  device_name text NOT NULL,
  client_version text NOT NULL,
  scopes jsonb DEFAULT '[]'::jsonb,
  ip_address text,
  user_agent text,
  revocation_reason text,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1b. Create extension device session events table (to prevent session row bloat)
CREATE TABLE IF NOT EXISTS extension_device_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES extension_device_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('login', 'file_write', 'lock_acquire', 'logout', 'revocation', 'auth_code_issued', 'auth_code_consumed')),
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2. Create Git sync deltas table with explicit unique sequence constraint
CREATE TABLE IF NOT EXISTS project_git_deltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL, -- ON DELETE SET NULL for durable sync log
  target_branch text NOT NULL,
  sequence_number bigint NOT NULL,
  delta_order integer NOT NULL, -- stable ordering within a sequence
  action text NOT NULL CHECK (action IN ('add', 'modify', 'delete', 'rename')),
  node_id uuid REFERENCES project_nodes(id) ON DELETE SET NULL,
  path text NOT NULL,
  old_path text,
  git_blob_hash text,
  file_version_id uuid REFERENCES file_versions(id) ON DELETE SET NULL,
  s3_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  job_id uuid,
  processed_commit_sha text,
  processing_error text,
  processed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_git_deltas_unique_seq UNIQUE (project_id, target_branch, sequence_number, delta_order)
);

-- 3. Create import jobs & file metadata tables
CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'importing', 'completed', 'failed')),
  total_files integer NOT NULL DEFAULT 0,
  processed_files integer NOT NULL DEFAULT 0,
  manifest_s3_key text,
  manifest_hash text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_job_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  path text NOT NULL,
  size bigint NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'completed', 'failed')),
  upload_intent_id uuid REFERENCES upload_intents(id) ON DELETE SET NULL,
  s3_key text,
  error_message text,
  finalized_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. Create conflict workspace table
CREATE TABLE IF NOT EXISTS project_node_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  git_branch text NOT NULL,
  canonical_content text,
  incoming_content text,
  merged_content text,
  conflict_status text NOT NULL DEFAULT 'unresolved' CHECK (conflict_status IN ('unresolved', 'resolved')),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 5. Add columns with safe defaults
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_sequence_number bigint NOT NULL DEFAULT 0;

ALTER TABLE project_node_locks 
  ADD COLUMN IF NOT EXISTS session_id uuid;

ALTER TABLE project_nodes 
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS canonical_node_id uuid REFERENCES project_nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_synced_commit_sha text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'merged' CHECK (sync_status IN ('draft', 'ready_for_review', 'merged', 'git_synced', 'deleted_tombstone'));

-- Defensive rename wrap to avoid migration failure in pre-renamed/partially migrated environments
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_nodes' AND column_name = 'git_hash') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_nodes' AND column_name = 'git_blob_hash') THEN
      -- Both columns exist, reconcile data (copy git_hash to git_blob_hash if null) and drop the old one
      UPDATE project_nodes SET git_blob_hash = COALESCE(git_blob_hash, git_hash);
      ALTER TABLE project_nodes DROP COLUMN git_hash;
    ELSE
      -- Only old column exists, rename it
      ALTER TABLE project_nodes RENAME COLUMN git_hash TO git_blob_hash;
    END IF;
  ELSE
    -- Old column does not exist, check if new column exists; if not, add it
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_nodes' AND column_name = 'git_blob_hash') THEN
      ALTER TABLE project_nodes ADD COLUMN git_blob_hash text;
    END IF;
  END IF;
END $$;

ALTER TABLE project_node_events ADD COLUMN IF NOT EXISTS sequence_number bigint;

-- Phase 2: Run sequence backfill for legacy event rows & projects counter
-- A. Backfill pne.sequence_number using ROW_NUMBER partitioned by project ordered by created_at, id
WITH backfill AS (
  SELECT id, created_at, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at ASC, id ASC) as seq
  FROM project_node_events
)
UPDATE project_node_events pne
SET sequence_number = backfill.seq
FROM backfill
WHERE pne.id = backfill.id AND pne.created_at = backfill.created_at AND pne.sequence_number IS NULL;

-- Set event sequence column to NOT NULL after backfill completes
ALTER TABLE project_node_events ALTER COLUMN sequence_number SET NOT NULL;

-- B. Backfill projects.current_sequence_number to match the maximum allocated sequence per project
UPDATE projects p
SET current_sequence_number = COALESCE((
  SELECT MAX(sequence_number) 
  FROM project_node_events pne 
  WHERE pne.project_id = p.id
), 0);

-- Create optimization & operational indexes
CREATE INDEX IF NOT EXISTS project_nodes_task_status_idx ON project_nodes (project_id, task_id, sync_status);
CREATE INDEX IF NOT EXISTS project_nodes_canonical_idx ON project_nodes (project_id, canonical_node_id);
CREATE INDEX IF NOT EXISTS project_nodes_sync_git_idx ON project_nodes (project_id, sync_status, git_blob_hash);
CREATE UNIQUE INDEX IF NOT EXISTS project_node_events_seq_idx ON project_node_events (project_id, sequence_number, created_at);

-- New operational indexes for critical performance paths (updated processed -> status)
CREATE INDEX IF NOT EXISTS project_git_deltas_sync_idx ON project_git_deltas (project_id, target_branch, status, sequence_number, delta_order);
CREATE INDEX IF NOT EXISTS extension_device_sessions_lookup_idx ON extension_device_sessions (token_prefix, token_hash, user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS project_node_locks_cleanup_idx ON project_node_locks (project_id, session_id);
CREATE INDEX IF NOT EXISTS import_job_files_status_idx ON import_job_files (job_id, status);
