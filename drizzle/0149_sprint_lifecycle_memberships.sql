ALTER TYPE "public"."status_sprint" ADD VALUE IF NOT EXISTS 'archived';
ALTER TYPE "public"."status_sprint" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "project_sprints"
    ADD COLUMN IF NOT EXISTS "sprint_number" integer,
    ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

WITH numbered AS (
    SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)::integer AS sprint_number
    FROM "project_sprints"
)
UPDATE "project_sprints" s
SET "sprint_number" = numbered.sprint_number
FROM numbered
WHERE s.id = numbered.id AND s."sprint_number" IS NULL;

UPDATE "project_sprints"
SET "started_at" = COALESCE("started_at", "created_at")
WHERE status IN ('active', 'completed');

UPDATE "project_sprints"
SET "completed_at" = COALESCE("completed_at", "updated_at")
WHERE status = 'completed';

ALTER TABLE "project_sprints" ALTER COLUMN "sprint_number" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "project_sprints_project_number_idx"
    ON "project_sprints" ("project_id", "sprint_number");

WITH ranked_active AS (
    SELECT id,
           row_number() OVER (PARTITION BY project_id ORDER BY COALESCE(started_at, created_at) DESC, id DESC) AS active_rank
    FROM "project_sprints"
    WHERE status = 'active'
)
UPDATE "project_sprints" s
SET status = 'completed',
    completed_at = COALESCE(s.completed_at, s.updated_at, now())
FROM ranked_active r
WHERE s.id = r.id AND r.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "project_sprints_one_active_idx"
    ON "project_sprints" ("project_id") WHERE "status" = 'active';

CREATE TABLE IF NOT EXISTS "sprint_task_memberships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "sprint_id" uuid NOT NULL REFERENCES "project_sprints"("id") ON DELETE RESTRICT,
    "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE RESTRICT,
    "added_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "removed_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "added_at" timestamp with time zone DEFAULT now() NOT NULL,
    "removed_at" timestamp with time zone
);

INSERT INTO "sprint_task_memberships" ("project_id", "sprint_id", "task_id", "added_at", "removed_at")
SELECT t.project_id, t.timeline_origin_sprint_id, t.id,
       COALESCE(t.timeline_origin_at, t.created_at),
       CASE WHEN t.sprint_id IS DISTINCT FROM t.timeline_origin_sprint_id THEN t.updated_at ELSE NULL END
FROM "tasks" t
WHERE t.timeline_origin_sprint_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "sprint_task_memberships" m
      WHERE m.task_id = t.id AND m.sprint_id = t.timeline_origin_sprint_id
  );

INSERT INTO "sprint_task_memberships" ("project_id", "sprint_id", "task_id", "added_at")
SELECT t.project_id, t.sprint_id, t.id, COALESCE(t.updated_at, t.created_at)
FROM "tasks" t
WHERE t.sprint_id IS NOT NULL
  AND t.sprint_id IS DISTINCT FROM t.timeline_origin_sprint_id
  AND NOT EXISTS (
      SELECT 1 FROM "sprint_task_memberships" m
      WHERE m.task_id = t.id AND m.sprint_id = t.sprint_id AND m.removed_at IS NULL
  );

CREATE INDEX IF NOT EXISTS "sprint_task_memberships_sprint_added_idx"
    ON "sprint_task_memberships" ("sprint_id", "added_at", "id");
CREATE INDEX IF NOT EXISTS "sprint_task_memberships_task_added_idx"
    ON "sprint_task_memberships" ("task_id", "added_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "sprint_task_memberships_active_task_idx"
    ON "sprint_task_memberships" ("task_id") WHERE "removed_at" IS NULL;
