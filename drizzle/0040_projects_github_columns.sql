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
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_github_repo
ON projects (github_repo_url)
WHERE github_repo_url IS NOT NULL;
