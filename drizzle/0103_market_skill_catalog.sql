-- Canonical, versioned market skills catalog.
-- Existing JSONB arrays remain compatibility mirrors during the dual-read rollout.

CREATE TABLE IF NOT EXISTS "skill_categories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "key" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "icon_key" text NOT NULL DEFAULT 'badge',
    "display_order" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'active',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_categories_key_unique" UNIQUE("key"),
    CONSTRAINT "skill_categories_status_check" CHECK ("status" IN ('active', 'hidden'))
);
CREATE INDEX IF NOT EXISTS "skill_categories_order_idx" ON "skill_categories" ("status", "display_order");

ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "canonical_key" text;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "category_id" uuid;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'competency';
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "icon_source" text NOT NULL DEFAULT 'monogram';
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "icon_key" text NOT NULL DEFAULT 'badge';
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "brand_color" text;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "market_tier" text NOT NULL DEFAULT 'extended';
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "selectable" boolean NOT NULL DEFAULT true;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "replacement_skill_id" uuid;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "catalog_version" text NOT NULL DEFAULT 'legacy';
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "last_reviewed_at" timestamptz;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

UPDATE "skills"
SET "canonical_key" = 'legacy.' || "slug"
WHERE "canonical_key" IS NULL OR btrim("canonical_key") = '';

ALTER TABLE "skills" ALTER COLUMN "canonical_key" SET NOT NULL;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_canonical_key_unique" UNIQUE("canonical_key");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_category_id_skill_categories_id_fk"
        FOREIGN KEY ("category_id") REFERENCES "public"."skill_categories"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_replacement_skill_id_skills_id_fk"
        FOREIGN KEY ("replacement_skill_id") REFERENCES "public"."skills"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_kind_check"
        CHECK ("kind" IN ('language','framework','library','database','platform','tool','protocol','methodology','competency','domain'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_market_tier_check"
        CHECK ("market_tier" IN ('core','extended','reference'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_status_check"
        CHECK ("status" IN ('active','deprecated','merged','hidden','pending'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "skills" ADD CONSTRAINT "skills_icon_source_check"
        CHECK ("icon_source" IN ('simple-icons','lucide','custom','monogram'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "skills_category_kind_status_idx" ON "skills" ("category_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "skills_tier_status_name_idx" ON "skills" ("market_tier", "status", "name");
CREATE INDEX IF NOT EXISTS "skills_search_document_idx"
    ON "skills" USING gin (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", '')));

CREATE TABLE IF NOT EXISTS "skill_aliases" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "skill_id" uuid NOT NULL REFERENCES "public"."skills"("id") ON DELETE CASCADE,
    "alias" text NOT NULL,
    "normalized_alias" text NOT NULL,
    "locale" text NOT NULL DEFAULT 'en',
    "source" text NOT NULL DEFAULT 'catalog',
    "is_preferred" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_aliases_normalized_locale_unique" UNIQUE("normalized_alias", "locale")
);
CREATE INDEX IF NOT EXISTS "skill_aliases_skill_idx" ON "skill_aliases" ("skill_id");
CREATE INDEX IF NOT EXISTS "skill_aliases_search_idx" ON "skill_aliases" USING gin ("normalized_alias" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "skill_relationships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "from_skill_id" uuid NOT NULL REFERENCES "public"."skills"("id") ON DELETE CASCADE,
    "to_skill_id" uuid NOT NULL REFERENCES "public"."skills"("id") ON DELETE CASCADE,
    "relationship" text NOT NULL,
    "weight" integer NOT NULL DEFAULT 50,
    "source" text NOT NULL DEFAULT 'catalog',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_relationships_unique" UNIQUE("from_skill_id", "to_skill_id", "relationship"),
    CONSTRAINT "skill_relationships_no_self_check" CHECK ("from_skill_id" <> "to_skill_id"),
    CONSTRAINT "skill_relationships_kind_check" CHECK ("relationship" IN ('related','prerequisite','successor','ecosystem','commonly_used_with')),
    CONSTRAINT "skill_relationships_weight_check" CHECK ("weight" BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS "skill_relationships_from_idx" ON "skill_relationships" ("from_skill_id", "relationship");
CREATE INDEX IF NOT EXISTS "skill_relationships_to_idx" ON "skill_relationships" ("to_skill_id", "relationship");

CREATE TABLE IF NOT EXISTS "skill_icon_assets" (
    "icon_key" text PRIMARY KEY NOT NULL,
    "source" text NOT NULL,
    "source_slug" text,
    "source_version" text NOT NULL,
    "asset_path" text NOT NULL,
    "checksum" text NOT NULL,
    "brand_color" text,
    "license_type" text,
    "license_url" text,
    "source_url" text,
    "guidelines_url" text,
    "approval_status" text NOT NULL DEFAULT 'catalog_approved',
    "last_reviewed_at" timestamptz NOT NULL DEFAULT now(),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_icon_assets_source_check" CHECK ("source" IN ('simple-icons','lucide','custom')),
    CONSTRAINT "skill_icon_assets_approval_check" CHECK ("approval_status" IN ('catalog_approved','blocked','needs_review'))
);

CREATE TABLE IF NOT EXISTS "skill_catalog_releases" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "version" text NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "manifest_hash" text NOT NULL,
    "source_versions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "published_by" uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "published_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_catalog_releases_version_unique" UNIQUE("version"),
    CONSTRAINT "skill_catalog_releases_status_check" CHECK ("status" IN ('draft','published','rolled_back'))
);

CREATE TABLE IF NOT EXISTS "skill_popularity_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "skill_id" uuid NOT NULL REFERENCES "public"."skills"("id") ON DELETE CASCADE,
    "source" text NOT NULL,
    "score" integer NOT NULL DEFAULT 0,
    "rank" integer,
    "sample_size" integer,
    "captured_at" timestamptz NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_popularity_snapshot_unique" UNIQUE("skill_id", "source", "captured_at"),
    CONSTRAINT "skill_popularity_score_check" CHECK ("score" >= 0)
);
CREATE INDEX IF NOT EXISTS "skill_popularity_source_rank_idx" ON "skill_popularity_snapshots" ("source", "captured_at" DESC, "rank");

CREATE TABLE IF NOT EXISTS "skill_proposals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "submitted_by" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
    "label" text NOT NULL,
    "normalized_label" text NOT NULL,
    "context" text,
    "status" text NOT NULL DEFAULT 'pending',
    "resolved_skill_id" uuid REFERENCES "public"."skills"("id") ON DELETE SET NULL,
    "reviewed_by" uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "reviewed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "skill_proposals_status_check" CHECK ("status" IN ('pending','accepted','merged','rejected')),
    CONSTRAINT "skill_proposals_user_label_unique" UNIQUE("submitted_by", "normalized_label")
);
CREATE INDEX IF NOT EXISTS "skill_proposals_status_created_idx" ON "skill_proposals" ("status", "created_at");

ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "proficiency" text;
ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "years_experience" integer;
ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT false;
ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "display_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'public';
ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "profile_skills" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS "profile_skills_profile_order_idx" ON "profile_skills" ("profile_id", "display_order");

ALTER TABLE "project_skills" ADD COLUMN IF NOT EXISTS "usage_kind" text NOT NULL DEFAULT 'used';
ALTER TABLE "project_skills" ADD COLUMN IF NOT EXISTS "display_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "project_skills" ADD COLUMN IF NOT EXISTS "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "project_skills" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS "project_skills_project_order_idx" ON "project_skills" ("project_id", "display_order");

CREATE TABLE IF NOT EXISTS "role_skills" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "role_id" uuid NOT NULL REFERENCES "public"."project_open_roles"("id") ON DELETE CASCADE,
    "skill_id" uuid NOT NULL REFERENCES "public"."skills"("id") ON DELETE CASCADE,
    "requirement" text NOT NULL DEFAULT 'required',
    "minimum_proficiency" text,
    "display_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "role_skills_unique" UNIQUE("role_id", "skill_id"),
    CONSTRAINT "role_skills_requirement_check" CHECK ("requirement" IN ('required','preferred'))
);
CREATE INDEX IF NOT EXISTS "role_skills_role_order_idx" ON "role_skills" ("role_id", "display_order");
CREATE INDEX IF NOT EXISTS "role_skills_skill_idx" ON "role_skills" ("skill_id");

CREATE TABLE IF NOT EXISTS "profile_contribution_skills" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "contribution_id" uuid NOT NULL REFERENCES "public"."profile_project_contributions"("id") ON DELETE CASCADE,
    "skill_id" uuid NOT NULL REFERENCES "public"."skills"("id") ON DELETE CASCADE,
    "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "verified_at" timestamptz,
    "verified_by" uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "display_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "profile_contribution_skills_unique" UNIQUE("contribution_id", "skill_id")
);
CREATE INDEX IF NOT EXISTS "profile_contribution_skills_contribution_order_idx" ON "profile_contribution_skills" ("contribution_id", "display_order");
CREATE INDEX IF NOT EXISTS "profile_contribution_skills_skill_idx" ON "profile_contribution_skills" ("skill_id");

ALTER TABLE "skill_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_aliases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_relationships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_icon_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_catalog_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_popularity_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_contribution_skills" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Skill categories are publicly readable" ON "skill_categories";
CREATE POLICY "Skill categories are publicly readable" ON "skill_categories" FOR SELECT USING ("status" = 'active');
DROP POLICY IF EXISTS "Skill aliases are publicly readable" ON "skill_aliases";
CREATE POLICY "Skill aliases are publicly readable" ON "skill_aliases" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Skill relationships are publicly readable" ON "skill_relationships";
CREATE POLICY "Skill relationships are publicly readable" ON "skill_relationships" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Skill icons are publicly readable" ON "skill_icon_assets";
CREATE POLICY "Skill icons are publicly readable" ON "skill_icon_assets" FOR SELECT USING ("approval_status" = 'catalog_approved');
DROP POLICY IF EXISTS "Published skill catalogs are publicly readable" ON "skill_catalog_releases";
CREATE POLICY "Published skill catalogs are publicly readable" ON "skill_catalog_releases" FOR SELECT USING ("status" = 'published');
DROP POLICY IF EXISTS "Skill popularity is publicly readable" ON "skill_popularity_snapshots";
CREATE POLICY "Skill popularity is publicly readable" ON "skill_popularity_snapshots" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can read own skill proposals" ON "skill_proposals";
CREATE POLICY "Users can read own skill proposals" ON "skill_proposals" FOR SELECT USING ("submitted_by" = auth.uid());
DROP POLICY IF EXISTS "Users can submit own skill proposals" ON "skill_proposals";
CREATE POLICY "Users can submit own skill proposals" ON "skill_proposals" FOR INSERT WITH CHECK ("submitted_by" = auth.uid());
DROP POLICY IF EXISTS "Role skills are publicly readable" ON "role_skills";
CREATE POLICY "Role skills are publicly readable" ON "role_skills" FOR SELECT USING (true);
DROP POLICY IF EXISTS "Visible contribution skills are readable" ON "profile_contribution_skills";
CREATE POLICY "Visible contribution skills are readable" ON "profile_contribution_skills" FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM "profile_project_contributions" contribution
        WHERE contribution."id" = "profile_contribution_skills"."contribution_id"
          AND contribution."deleted_at" IS NULL
          AND (contribution."visibility" = 'public' OR contribution."profile_id" = auth.uid())
    )
);
