-- Make the normalized contribution projection the only public/edit authority.
-- Platform contributions reference a project; external contributions use a stable external key.

ALTER TABLE "profile_project_contributions" ADD COLUMN IF NOT EXISTS "external_key" text;
ALTER TABLE "profile_project_contributions" ADD COLUMN IF NOT EXISTS "project_title" text;
ALTER TABLE "profile_project_contributions" ADD COLUMN IF NOT EXISTS "project_url" text;
ALTER TABLE "profile_project_contributions" ADD COLUMN IF NOT EXISTS "repository_url" text;
ALTER TABLE "profile_project_contributions" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "profile_project_contributions" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "profile_project_contribution_stages" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "profile_project_contributions" DROP COLUMN IF EXISTS "highlights";

DROP INDEX IF EXISTS "profile_project_contributions_profile_project_active_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "profile_project_contributions_profile_project_active_unique"
  ON "profile_project_contributions" ("profile_id", "project_id")
  WHERE "deleted_at" IS NULL AND "project_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "profile_project_contributions_profile_external_active_unique"
  ON "profile_project_contributions" ("profile_id", "external_key")
  WHERE "deleted_at" IS NULL AND "project_id" IS NULL;

DO $$ BEGIN
  ALTER TABLE "profile_project_contributions"
    ADD CONSTRAINT "profile_project_contributions_authority_shape_check"
    CHECK (
      ("project_id" IS NOT NULL AND "external_key" IS NULL)
      OR
      ("project_id" IS NULL AND "external_key" IS NOT NULL AND NULLIF(BTRIM("project_title"), '') IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "profile_project_contributions"
    ADD CONSTRAINT "profile_project_contributions_version_check" CHECK ("version" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Preserve existing user presentation overrides for platform contributions.
WITH entries AS (
  SELECT
    p.id AS profile_id,
    entry.value AS item
  FROM "profiles" p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.experience, '[]'::jsonb)) entry(value)
  WHERE jsonb_typeof(entry.value) = 'object'
    AND COALESCE(entry.value->>'projectId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
UPDATE "profile_project_contributions" contribution
SET
  "summary" = NULLIF(BTRIM(entries.item->>'description'), ''),
  "repository_url" = CASE
    WHEN COALESCE(entries.item->>'repoUrl', '') ~* '^https?://' THEN BTRIM(entries.item->>'repoUrl')
    ELSE NULL
  END,
  "project_url" = CASE
    WHEN COALESCE(entries.item->>'projectUrl', '') ~* '^https?://' THEN BTRIM(entries.item->>'projectUrl')
    ELSE NULL
  END,
  "visibility" = CASE WHEN entries.item->>'visibility' = 'private' THEN 'private' ELSE 'public' END,
  "started_at" = CASE
    WHEN COALESCE(entries.item->>'startDate', '') ~ '^\d{4}-(0[1-9]|1[0-2])$'
      THEN to_date(entries.item->>'startDate', 'YYYY-MM')::timestamptz
    ELSE contribution.started_at
  END,
  "ended_at" = CASE
    WHEN COALESCE(entries.item->>'endDate', '') ~ '^\d{4}-(0[1-9]|1[0-2])$'
      THEN to_date(entries.item->>'endDate', 'YYYY-MM')::timestamptz
    ELSE NULL
  END,
  "skills" = CASE
    WHEN jsonb_typeof(entries.item->'techTags') = 'array' THEN entries.item->'techTags'
    ELSE contribution.skills
  END,
  "updated_at" = now()
FROM entries
WHERE contribution.profile_id = entries.profile_id
  AND contribution.project_id = (entries.item->>'projectId')::uuid
  AND contribution.deleted_at IS NULL;

-- Normalize legacy external contribution entries. The deterministic fallback key makes reruns safe.
WITH entries AS (
  SELECT
    p.id AS profile_id,
    entry.value AS item
  FROM "profiles" p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.experience, '[]'::jsonb)) entry(value)
  WHERE jsonb_typeof(entry.value) = 'object'
    AND COALESCE(entry.value->>'projectId', '') = ''
    AND NULLIF(BTRIM(entry.value->>'company'), '') IS NOT NULL
)
INSERT INTO "profile_project_contributions" (
  "profile_id", "project_id", "external_key", "project_title", "project_url", "repository_url",
  "source", "role_kind", "role_title", "summary", "skills", "started_at", "ended_at",
  "visibility", "version", "created_at", "updated_at"
)
SELECT
  entries.profile_id,
  NULL,
  COALESCE(NULLIF(BTRIM(entries.item->>'id'), ''), 'legacy:' || md5(entries.item::text)),
  LEFT(BTRIM(entries.item->>'company'), 120),
  CASE WHEN COALESCE(entries.item->>'projectUrl', '') ~* '^https?://' THEN BTRIM(entries.item->>'projectUrl') END,
  CASE WHEN COALESCE(entries.item->>'repoUrl', '') ~* '^https?://' THEN BTRIM(entries.item->>'repoUrl') END,
  'manual',
  'contributor',
  NULLIF(BTRIM(entries.item->>'title'), ''),
  NULLIF(BTRIM(entries.item->>'description'), ''),
  CASE WHEN jsonb_typeof(entries.item->'techTags') = 'array' THEN entries.item->'techTags' ELSE '[]'::jsonb END,
  CASE WHEN COALESCE(entries.item->>'startDate', '') ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN to_date(entries.item->>'startDate', 'YYYY-MM')::timestamptz END,
  CASE WHEN COALESCE(entries.item->>'endDate', '') ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN to_date(entries.item->>'endDate', 'YYYY-MM')::timestamptz END,
  CASE WHEN entries.item->>'visibility' = 'private' THEN 'private' ELSE 'public' END,
  1,
  now(),
  now()
FROM entries
ON CONFLICT DO NOTHING;

-- Preserve legacy labels that are not yet in the shared catalog. These rows are
-- pending catalog entries, but the relational edge remains the only read authority.
WITH labels AS (
  SELECT DISTINCT LEFT(BTRIM(skill_label.value), 80) AS label
  FROM "profile_project_contributions" contribution
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(contribution.skills, '[]'::jsonb))
    skill_label(value)
  WHERE contribution.deleted_at IS NULL
    AND BTRIM(skill_label.value) <> ''
)
INSERT INTO "skills" (
  "name", "slug", "canonical_key", "kind", "icon_source", "icon_key",
  "market_tier", "status", "selectable", "source_metadata", "catalog_version",
  "created_at", "updated_at"
)
SELECT
  labels.label,
  'legacy-' || md5(lower(labels.label)),
  'legacy.' || md5(lower(labels.label)),
  'competency',
  'monogram',
  'badge',
  'extended',
  'pending',
  true,
  jsonb_build_object('source', 'profile-contribution-backfill'),
  'legacy',
  now(),
  now()
FROM labels
WHERE NOT EXISTS (
  SELECT 1 FROM "skills" skill WHERE lower(skill.name) = lower(labels.label)
)
ON CONFLICT DO NOTHING;

-- Resolve the compatibility JSON skill names into the relational skill authority.
WITH labels AS (
  SELECT
    contribution.id AS contribution_id,
    LEFT(BTRIM(skill_label.value), 80) AS label,
    skill_label.ordinality - 1 AS display_order
  FROM "profile_project_contributions" contribution
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(contribution.skills, '[]'::jsonb))
    WITH ORDINALITY skill_label(value, ordinality)
  WHERE contribution.deleted_at IS NULL
    AND BTRIM(skill_label.value) <> ''
), resolved AS (
  SELECT DISTINCT ON (labels.contribution_id, skill.id)
    labels.contribution_id,
    skill.id AS skill_id,
    labels.display_order
  FROM labels
  INNER JOIN "skills" skill ON lower(skill.name) = lower(labels.label)
  ORDER BY labels.contribution_id, skill.id, labels.display_order
)
INSERT INTO "profile_contribution_skills" ("contribution_id", "skill_id", "display_order")
SELECT contribution_id, skill_id, display_order FROM resolved
ON CONFLICT ("contribution_id", "skill_id") DO UPDATE
SET "display_order" = EXCLUDED."display_order", "updated_at" = now();

-- The parent row owns visibility. Stage visibility remains a compatibility mirror only.
UPDATE "profile_project_contribution_stages" stage
SET "visibility" = contribution.visibility, "updated_at" = now()
FROM "profile_project_contributions" contribution
WHERE contribution.id = stage.contribution_id
  AND stage.deleted_at IS NULL
  AND stage.visibility IS DISTINCT FROM contribution.visibility;

DROP POLICY IF EXISTS "Public profile contributions are viewable" ON "profile_project_contributions";
CREATE POLICY "Public profile contributions are viewable"
ON "profile_project_contributions" FOR SELECT
USING (
  "visibility" = 'public'
  AND "deleted_at" IS NULL
  AND (
    ("project_id" IS NULL AND "external_key" IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM "projects" project
      WHERE project.id = "profile_project_contributions"."project_id"
        AND project.deleted_at IS NULL
        AND project.visibility IN ('public', 'unlisted')
        AND project.status <> 'draft'
    )
  )
);

DROP POLICY IF EXISTS "Public profile contribution stages are viewable" ON "profile_project_contribution_stages";
CREATE POLICY "Public profile contribution stages are viewable"
ON "profile_project_contribution_stages" FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "profile_project_contributions" contribution
    LEFT JOIN "projects" project ON project.id = contribution.project_id
    WHERE contribution.id = "profile_project_contribution_stages"."contribution_id"
      AND contribution.deleted_at IS NULL
      AND contribution.visibility = 'public'
      AND (
        (contribution.project_id IS NULL AND contribution.external_key IS NOT NULL)
        OR (project.deleted_at IS NULL AND project.visibility IN ('public', 'unlisted') AND project.status <> 'draft')
      )
  )
);

DROP POLICY IF EXISTS "Visible contribution skills are readable" ON "profile_contribution_skills";
CREATE POLICY "Visible contribution skills are readable" ON "profile_contribution_skills" FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM "profile_project_contributions" contribution
    LEFT JOIN "projects" project ON project.id = contribution.project_id
    WHERE contribution.id = "profile_contribution_skills"."contribution_id"
      AND contribution.deleted_at IS NULL
      AND (
        contribution.profile_id = app_private.get_auth_uid()
        OR (
          contribution.visibility = 'public'
          AND (
            (contribution.project_id IS NULL AND contribution.external_key IS NOT NULL)
            OR (project.deleted_at IS NULL AND project.visibility IN ('public', 'unlisted') AND project.status <> 'draft')
          )
        )
      )
  )
);

UPDATE "profile_collaboration_summaries"
SET "version" = GREATEST("version", 5), "stale" = true, "updated_at" = now();

-- Idempotency becomes enforceable even if an older retry path wrote duplicates.
WITH duplicate_batches AS (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY "user_id", "metadata"->>'idempotencyKey'
        ORDER BY "created_at" DESC, id DESC
      ) AS duplicate_rank
    FROM "profile_audit_events"
    WHERE "event_type" = 'profile_contribution_batch_saved'
      AND NULLIF("metadata"->>'idempotencyKey', '') IS NOT NULL
  ) ranked
  WHERE ranked.duplicate_rank > 1
)
DELETE FROM "profile_audit_events" event
USING duplicate_batches duplicate
WHERE event.id = duplicate.id;

CREATE UNIQUE INDEX IF NOT EXISTS "profile_audit_events_contribution_batch_key_unique"
  ON "profile_audit_events" ("user_id", (("metadata"->>'idempotencyKey')))
  WHERE "event_type" = 'profile_contribution_batch_saved'
    AND NULLIF("metadata"->>'idempotencyKey', '') IS NOT NULL;
