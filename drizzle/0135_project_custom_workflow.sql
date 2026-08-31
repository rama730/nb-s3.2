ALTER TABLE "projects"
    ADD COLUMN IF NOT EXISTS "custom_workflow" jsonb;

UPDATE "projects"
SET "custom_workflow" = '[]'::jsonb
WHERE "custom_workflow" IS NULL;

ALTER TABLE "projects"
    ALTER COLUMN "custom_workflow" SET DEFAULT '[]'::jsonb;

ALTER TABLE "projects"
    ALTER COLUMN "custom_workflow" SET NOT NULL;
