-- Add denormalized counters for project stats
ALTER TABLE projects ADD COLUMN IF NOT EXISTS followers_count integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS saves_count integer NOT NULL DEFAULT 0;

-- Backfill followers_count from project_follows
UPDATE projects p
SET followers_count = COALESCE(f.count, 0)
FROM (
    SELECT project_id, COUNT(*)::int AS count
    FROM project_follows
    GROUP BY project_id
) f
WHERE p.id = f.project_id;

-- Backfill saves_count from saved_projects
UPDATE projects p
SET saves_count = COALESCE(s.count, 0)
FROM (
    SELECT project_id, COUNT(*)::int AS count
    FROM saved_projects
    GROUP BY project_id
) s
WHERE p.id = s.project_id;

-- Deduplicate follows before enforcing uniqueness
DELETE FROM project_follows a
USING project_follows b
WHERE a.project_id = b.project_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

-- Enforce unique follow per user per project
DROP INDEX IF EXISTS project_follows_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS project_follows_unique_idx ON project_follows (project_id, user_id);

-- Deduplicate saves before enforcing uniqueness
DELETE FROM saved_projects a
USING saved_projects b
WHERE a.user_id = b.user_id
  AND a.project_id = b.project_id
  AND a.id < b.id;

-- Enforce unique save per user per project
DROP INDEX IF EXISTS saved_projects_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS saved_projects_unique_idx ON saved_projects (user_id, project_id);
