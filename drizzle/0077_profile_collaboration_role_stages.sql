CREATE TABLE IF NOT EXISTS "profile_project_contribution_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contribution_id" uuid NOT NULL REFERENCES "profile_project_contributions"("id") ON DELETE cascade,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "source" text DEFAULT 'membership' NOT NULL,
  "role_kind" text DEFAULT 'contributor' NOT NULL,
  "role_title" text,
  "summary" text,
  "skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "verified_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "event_id" uuid,
  "visibility" text DEFAULT 'public' NOT NULL,
  "manual_override" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "profile_project_contribution_stages_source_check"
    CHECK ("source" IN ('membership', 'application', 'owner', 'manual', 'role_change', 'project_invite', 'ownership_transfer', 'removal', 'backfill')),
  CONSTRAINT "profile_project_contribution_stages_role_kind_check"
    CHECK ("role_kind" IN ('owner', 'admin', 'member', 'viewer', 'contributor')),
  CONSTRAINT "profile_project_contribution_stages_visibility_check"
    CHECK ("visibility" IN ('public', 'private'))
);

CREATE INDEX IF NOT EXISTS "profile_project_contribution_stages_contribution_idx"
  ON "profile_project_contribution_stages" ("contribution_id", "started_at" DESC, "created_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "profile_project_contribution_stages_profile_project_idx"
  ON "profile_project_contribution_stages" ("profile_id", "project_id", "started_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "profile_project_contribution_stages_current_unique"
  ON "profile_project_contribution_stages" ("contribution_id")
  WHERE "deleted_at" IS NULL AND "ended_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "profile_project_contribution_stages_event_unique"
  ON "profile_project_contribution_stages" ("event_id")
  WHERE "event_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "profile_project_contribution_stages_visible_idx"
  ON "profile_project_contribution_stages" ("profile_id", "visibility", "started_at" DESC)
  WHERE "deleted_at" IS NULL;

UPDATE "profile_project_contributions"
SET
  "role_title" = 'Co-lead',
  "updated_at" = now()
WHERE "role_kind" = 'admin'
  AND "role_title" = 'Admin'
  AND "deleted_at" IS NULL;

INSERT INTO "profile_project_contribution_stages" (
  "contribution_id",
  "profile_id",
  "project_id",
  "source",
  "role_kind",
  "role_title",
  "summary",
  "skills",
  "started_at",
  "ended_at",
  "verified_at",
  "verified_by",
  "visibility",
  "display_order",
  "created_at",
  "updated_at"
)
SELECT
  pc.id,
  pc.profile_id,
  pc.project_id,
  CASE WHEN pc.source IN ('membership', 'application', 'owner', 'manual') THEN pc.source ELSE 'backfill' END,
  pc.role_kind,
  pc.role_title,
  pc.summary,
  COALESCE(pc.skills, '[]'::jsonb),
  COALESCE(pc.started_at, pc.created_at),
  pc.ended_at,
  pc.verified_at,
  pc.verified_by,
  pc.visibility,
  0,
  COALESCE(pc.created_at, now()),
  now()
FROM "profile_project_contributions" pc
WHERE pc.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "profile_project_contribution_stages" pcs
    WHERE pcs.contribution_id = pc.id
      AND pcs.deleted_at IS NULL
  );

ALTER TABLE "profile_project_contribution_stages" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profile contribution stages are viewable" ON "profile_project_contribution_stages";
CREATE POLICY "Public profile contribution stages are viewable"
ON "profile_project_contribution_stages" FOR SELECT
USING (
  "visibility" = 'public'
  AND EXISTS (
    SELECT 1
    FROM "profile_project_contributions" pc
    INNER JOIN "projects" p ON p.id = pc.project_id
    WHERE pc.id = "profile_project_contribution_stages"."contribution_id"
      AND pc.deleted_at IS NULL
      AND pc.visibility = 'public'
      AND p.deleted_at IS NULL
      AND p.visibility IN ('public', 'unlisted')
      AND p.status <> 'draft'
  )
);

DROP POLICY IF EXISTS "Users can view own profile contribution stages" ON "profile_project_contribution_stages";
CREATE POLICY "Users can view own profile contribution stages"
ON "profile_project_contribution_stages" FOR SELECT
USING ("profile_id" = public.get_auth_uid());

UPDATE "profile_collaboration_summaries"
SET
  "version" = 2,
  "stale" = true,
  "updated_at" = now();
