-- ============================================================================
-- Task attachment link uniqueness hardening
-- Prevent duplicate (task_id, node_id) rows under concurrent attach operations
-- ============================================================================

WITH ranked_links AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY task_id, node_id
            ORDER BY linked_at ASC, id ASC
        ) AS rn
    FROM task_node_links
)
DELETE FROM task_node_links tnl
USING ranked_links rl
WHERE tnl.id = rl.id
  AND rl.rn > 1;

DROP INDEX IF EXISTS task_node_links_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS task_node_links_unique_idx
ON task_node_links (task_id, node_id);
