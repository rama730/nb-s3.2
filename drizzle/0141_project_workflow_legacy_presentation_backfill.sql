-- Preserve any presentation-only configuration saved by the earlier JSON workflow.
-- `project_workflow_columns` is the source of truth after this migration.
WITH legacy_columns AS (
    SELECT
        p.id AS project_id,
        element,
        ordinal - 1 AS position
    FROM "projects" p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p."custom_workflow", '[]'::jsonb))
        WITH ORDINALITY AS saved(element, ordinal)
    WHERE element->>'id' IN ('todo', 'in_progress', 'blocked', 'done')
),
affected_projects AS (
    SELECT DISTINCT project_id FROM legacy_columns
)
UPDATE "project_workflow_columns" column_row
SET "position" = "position" + 100
WHERE column_row."is_default" = TRUE
  AND column_row."project_id" IN (SELECT project_id FROM affected_projects);

WITH legacy_columns AS (
    SELECT
        p.id AS project_id,
        element,
        ordinal - 1 AS position
    FROM "projects" p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p."custom_workflow", '[]'::jsonb))
        WITH ORDINALITY AS saved(element, ordinal)
    WHERE element->>'id' IN ('todo', 'in_progress', 'blocked', 'done')
)
UPDATE "project_workflow_columns" column_row
SET
    "title" = COALESCE(NULLIF(legacy.element->>'title', ''), column_row."title"),
    "accent_class_name" = COALESCE(NULLIF(legacy.element->>'accentClassName', ''), column_row."accent_class_name"),
    "empty_title" = COALESCE(NULLIF(legacy.element->>'emptyTitle', ''), column_row."empty_title"),
    "empty_description" = COALESCE(NULLIF(legacy.element->>'emptyDescription', ''), column_row."empty_description"),
    "position" = legacy.position,
    "updated_at" = now()
FROM legacy_columns legacy
WHERE column_row."project_id" = legacy.project_id
  AND column_row."is_default" = TRUE
  AND column_row."status"::text = legacy.element->>'id';
