-- ============================================================================
-- Project members uniqueness hardening
-- Prevent duplicate membership rows per (project_id, user_id)
-- ============================================================================

WITH ranked_members AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY project_id, user_id
            ORDER BY joined_at ASC, id ASC
        ) AS rn
    FROM project_members
)
DELETE FROM project_members pm
USING ranked_members rm
WHERE pm.id = rm.id
  AND rm.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_unique
ON project_members (project_id, user_id);
