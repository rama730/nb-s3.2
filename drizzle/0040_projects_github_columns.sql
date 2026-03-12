ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_url TEXT;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_default_branch TEXT DEFAULT 'main';
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_last_sync_at TIMESTAMP WITH TIME ZONE;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_last_commit_sha TEXT;
--> statement-breakpoint
ALTER TABLE project_nodes ADD COLUMN IF NOT EXISTS git_hash TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_github_repo
ON projects (github_repo_url)
WHERE github_repo_url IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_github_repo_branch
ON projects (github_repo_url, github_default_branch)
WHERE github_repo_url IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_github_repo_branch_active
ON projects (github_repo_url, github_default_branch, sync_status, updated_at DESC)
WHERE github_repo_url IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_sync_status_updated_active
ON projects (sync_status, updated_at DESC)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_nodes_active_file_reconcile
ON project_nodes (project_id, type, s3_key)
WHERE deleted_at IS NULL AND type = 'file';
