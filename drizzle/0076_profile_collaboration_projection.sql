CREATE TABLE IF NOT EXISTS "profile_project_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "source" text DEFAULT 'membership' NOT NULL,
  "role_kind" text DEFAULT 'contributor' NOT NULL,
  "role_title" text,
  "summary" text,
  "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "verified_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "visibility" text DEFAULT 'public' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "profile_project_contributions_source_check"
    CHECK ("source" IN ('membership', 'application', 'owner', 'manual')),
  CONSTRAINT "profile_project_contributions_role_kind_check"
    CHECK ("role_kind" IN ('owner', 'admin', 'member', 'viewer', 'contributor')),
  CONSTRAINT "profile_project_contributions_visibility_check"
    CHECK ("visibility" IN ('public', 'private'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "profile_project_contributions_profile_project_active_unique"
  ON "profile_project_contributions" ("profile_id", "project_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "profile_project_contributions_profile_visible_idx"
  ON "profile_project_contributions" ("profile_id", "visibility", "updated_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "profile_project_contributions_project_idx"
  ON "profile_project_contributions" ("project_id", "updated_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "profile_project_contributions_verified_idx"
  ON "profile_project_contributions" ("profile_id", "verified_at" DESC)
  WHERE "deleted_at" IS NULL AND "verified_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "profile_collaboration_summaries" (
  "profile_id" uuid PRIMARY KEY REFERENCES "profiles"("id") ON DELETE cascade,
  "version" integer DEFAULT 1 NOT NULL,
  "summary" jsonb DEFAULT '{"version":1,"generatedAt":"","projects":[],"featuredProjects":[],"contributions":[],"stats":{"projectsCount":0,"visibleProjectsCount":0,"contributionCount":0}}'::jsonb NOT NULL,
  "project_count" integer DEFAULT 0 NOT NULL,
  "visible_project_count" integer DEFAULT 0 NOT NULL,
  "contribution_count" integer DEFAULT 0 NOT NULL,
  "stale" boolean DEFAULT false NOT NULL,
  "refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "profile_collaboration_summaries_stale_idx"
  ON "profile_collaboration_summaries" ("stale", "updated_at");

CREATE INDEX IF NOT EXISTS "profile_collaboration_summaries_refreshed_idx"
  ON "profile_collaboration_summaries" ("refreshed_at");

INSERT INTO "profile_project_contributions" (
  "profile_id",
  "project_id",
  "source",
  "role_kind",
  "role_title",
  "skills",
  "started_at",
  "verified_at",
  "verified_by",
  "created_at",
  "updated_at"
)
SELECT
  seed.profile_id,
  seed.project_id,
  seed.source,
  seed.role_kind,
  seed.role_title,
  COALESCE(seed.skills, '[]'::jsonb),
  seed.started_at,
  now(),
  seed.verified_by,
  now(),
  now()
FROM (
  SELECT
    p.owner_id AS profile_id,
    p.id AS project_id,
    'owner'::text AS source,
    'owner'::text AS role_kind,
    COALESCE(NULLIF(ra.accepted_role_title, ''), 'Lead') AS role_title,
    COALESCE(p.skills, '[]'::jsonb) AS skills,
    p.created_at AS started_at,
    p.owner_id AS verified_by
  FROM "projects" p
  LEFT JOIN LATERAL (
    SELECT accepted_role_title
    FROM "role_applications"
    WHERE project_id = p.id
      AND applicant_id = p.owner_id
      AND status = 'accepted'
    ORDER BY updated_at DESC
    LIMIT 1
  ) ra ON true
  WHERE p.deleted_at IS NULL

  UNION ALL

  SELECT
    pm.user_id AS profile_id,
    pm.project_id,
    CASE WHEN ra.accepted_role_title IS NULL THEN 'membership' ELSE 'application' END AS source,
    pm.role AS role_kind,
    COALESCE(NULLIF(ra.accepted_role_title, ''),
      CASE
        WHEN pm.role = 'admin' THEN 'Admin'
        WHEN pm.role = 'viewer' THEN 'Viewer'
        ELSE 'Contributor'
      END
    ) AS role_title,
    COALESCE(p.skills, '[]'::jsonb) AS skills,
    pm.joined_at AS started_at,
    p.owner_id AS verified_by
  FROM "project_members" pm
  INNER JOIN "projects" p ON p.id = pm.project_id
  LEFT JOIN LATERAL (
    SELECT accepted_role_title
    FROM "role_applications"
    WHERE project_id = pm.project_id
      AND applicant_id = pm.user_id
      AND status = 'accepted'
    ORDER BY updated_at DESC
    LIMIT 1
  ) ra ON true
  WHERE p.deleted_at IS NULL
    AND pm.user_id <> p.owner_id
) seed
ON CONFLICT ("profile_id", "project_id") WHERE "deleted_at" IS NULL DO UPDATE SET
  "source" = EXCLUDED."source",
  "role_kind" = EXCLUDED."role_kind",
  "role_title" = EXCLUDED."role_title",
  "skills" = EXCLUDED."skills",
  "started_at" = COALESCE("profile_project_contributions"."started_at", EXCLUDED."started_at"),
  "verified_at" = COALESCE("profile_project_contributions"."verified_at", EXCLUDED."verified_at"),
  "verified_by" = COALESCE("profile_project_contributions"."verified_by", EXCLUDED."verified_by"),
  "updated_at" = now();

ALTER TABLE "profile_project_contributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_collaboration_summaries" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profile contributions are viewable" ON "profile_project_contributions";
CREATE POLICY "Public profile contributions are viewable"
ON "profile_project_contributions" FOR SELECT
USING (
  "visibility" = 'public'
  AND EXISTS (
    SELECT 1 FROM "projects" p
    WHERE p.id = "profile_project_contributions"."project_id"
      AND p.deleted_at IS NULL
      AND p.visibility IN ('public', 'unlisted')
      AND p.status <> 'draft'
  )
);

DROP POLICY IF EXISTS "Users can view own profile contributions" ON "profile_project_contributions";
CREATE POLICY "Users can view own profile contributions"
ON "profile_project_contributions" FOR SELECT
USING ("profile_id" = public.get_auth_uid());

DROP POLICY IF EXISTS "Users can view public collaboration summaries" ON "profile_collaboration_summaries";
CREATE POLICY "Users can view public collaboration summaries"
ON "profile_collaboration_summaries" FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "profiles" p
    WHERE p.id = "profile_collaboration_summaries"."profile_id"
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
  )
);

DROP POLICY IF EXISTS "Users can view own collaboration summaries" ON "profile_collaboration_summaries";
CREATE POLICY "Users can view own collaboration summaries"
ON "profile_collaboration_summaries" FOR SELECT
USING ("profile_id" = public.get_auth_uid());
