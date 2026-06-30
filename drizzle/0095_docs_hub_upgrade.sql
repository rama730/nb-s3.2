-- Rename tables
ALTER TABLE "project_readmes" RENAME TO "project_markdowns";--> statement-breakpoint
ALTER TABLE "project_readme_versions" RENAME TO "project_markdown_versions";--> statement-breakpoint
ALTER TABLE "project_readme_assets" RENAME TO "project_markdown_assets";--> statement-breakpoint
ALTER TABLE "project_readme_draft_contributors" RENAME TO "project_markdown_draft_contributors";--> statement-breakpoint

-- 1. Alter project_markdowns (formerly project_readmes)
ALTER TABLE "project_markdowns" ADD COLUMN IF NOT EXISTS "filename" text NOT NULL DEFAULT 'README.md';--> statement-breakpoint
ALTER TABLE "project_markdowns" ADD COLUMN IF NOT EXISTS "slug" text NOT NULL DEFAULT 'readme';--> statement-breakpoint

DROP INDEX IF EXISTS "project_readmes_project_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_markdowns_slug_unique" ON "project_markdowns" ("project_id", "slug");--> statement-breakpoint

DROP INDEX IF EXISTS "project_readmes_project_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdowns_project_idx" ON "project_markdowns" ("project_id");--> statement-breakpoint

DROP INDEX IF EXISTS "project_readmes_draft_updated_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdowns_draft_updated_idx" ON "project_markdowns" ("project_id", "draft_updated_at" DESC);--> statement-breakpoint

ALTER TABLE "project_markdowns" DROP CONSTRAINT IF EXISTS "project_readmes_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_markdowns" DROP CONSTRAINT IF EXISTS "project_readmes_draft_updated_by_profiles_id_fk";--> statement-breakpoint
ALTER TABLE "project_markdowns" DROP CONSTRAINT IF EXISTS "project_readmes_published_version_id_project_readme_versions_id_fk";--> statement-breakpoint

ALTER TABLE "project_markdowns" ADD CONSTRAINT "project_markdowns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_markdowns" ADD CONSTRAINT "project_markdowns_draft_updated_by_profiles_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint


-- 2. Alter project_markdown_versions (formerly project_readme_versions)
ALTER TABLE "project_markdown_versions" ADD COLUMN IF NOT EXISTS "markdown_id" uuid;--> statement-breakpoint

-- Backfill markdown_id
UPDATE "project_markdown_versions" v 
SET "markdown_id" = m."id" 
FROM "project_markdowns" m 
WHERE v."project_id" = m."project_id";--> statement-breakpoint

-- Delete orphaned versions (if any)
DELETE FROM "project_markdown_versions" WHERE "markdown_id" IS NULL;--> statement-breakpoint

-- Make markdown_id NOT NULL and add foreign key
ALTER TABLE "project_markdown_versions" ALTER COLUMN "markdown_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_markdown_versions" ADD CONSTRAINT "project_markdown_versions_markdown_id_project_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "project_markdowns"("id") ON DELETE CASCADE;--> statement-breakpoint

-- Add published_version_id foreign key back to project_markdowns
ALTER TABLE "project_markdowns" ADD CONSTRAINT "project_markdowns_published_version_id_project_markdown_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "project_markdown_versions"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "project_markdown_versions" DROP CONSTRAINT IF EXISTS "project_readme_versions_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_markdown_versions" DROP CONSTRAINT IF EXISTS "project_readme_versions_created_by_profiles_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_versions_project_version_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_versions_project_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_versions_project_hash_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_versions_project_deleted_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_versions_created_by_idx";--> statement-breakpoint

ALTER TABLE "project_markdown_versions" ADD CONSTRAINT "project_markdown_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_markdown_versions" ADD CONSTRAINT "project_markdown_versions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_markdown_versions_markdown_version_unique" ON "project_markdown_versions" ("markdown_id", "version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_versions_project_created_idx" ON "project_markdown_versions" ("project_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_versions_project_hash_idx" ON "project_markdown_versions" ("project_id", "content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_versions_project_deleted_idx" ON "project_markdown_versions" ("project_id", "deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_versions_created_by_idx" ON "project_markdown_versions" ("created_by");--> statement-breakpoint


-- 3. Alter project_markdown_assets (formerly project_readme_assets)
ALTER TABLE "project_markdown_assets" ADD COLUMN IF NOT EXISTS "markdown_id" uuid;--> statement-breakpoint

-- Backfill markdown_id
UPDATE "project_markdown_assets" a 
SET "markdown_id" = m."id" 
FROM "project_markdowns" m 
WHERE a."project_id" = m."project_id";--> statement-breakpoint

-- Delete orphaned assets
DELETE FROM "project_markdown_assets" WHERE "markdown_id" IS NULL;--> statement-breakpoint

ALTER TABLE "project_markdown_assets" ALTER COLUMN "markdown_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_markdown_assets" ADD CONSTRAINT "project_markdown_assets_markdown_id_project_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "project_markdowns"("id") ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "project_markdown_assets" DROP CONSTRAINT IF EXISTS "project_readme_assets_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_markdown_assets" DROP CONSTRAINT IF EXISTS "project_readme_assets_version_id_project_readme_versions_id_fk";--> statement-breakpoint
ALTER TABLE "project_markdown_assets" DROP CONSTRAINT IF EXISTS "project_readme_assets_created_by_profiles_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_assets_project_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_assets_bucket_storage_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_assets_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_assets_version_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_assets_created_by_idx";--> statement-breakpoint

ALTER TABLE "project_markdown_assets" ADD CONSTRAINT "project_markdown_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_markdown_assets" ADD CONSTRAINT "project_markdown_assets_version_id_project_markdown_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "project_markdown_versions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project_markdown_assets" ADD CONSTRAINT "project_markdown_assets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_markdown_assets_bucket_storage_unique" ON "project_markdown_assets" ("bucket", "storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_assets_project_created_idx" ON "project_markdown_assets" ("project_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_assets_status_idx" ON "project_markdown_assets" ("project_id", "status") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_assets_version_id_idx" ON "project_markdown_assets" ("version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_assets_created_by_idx" ON "project_markdown_assets" ("created_by");--> statement-breakpoint


-- 4. Alter project_markdown_draft_contributors (formerly project_readme_draft_contributors)
ALTER TABLE "project_markdown_draft_contributors" ADD COLUMN IF NOT EXISTS "markdown_id" uuid;--> statement-breakpoint

-- Backfill markdown_id
UPDATE "project_markdown_draft_contributors" c 
SET "markdown_id" = m."id" 
FROM "project_markdowns" m 
WHERE c."project_id" = m."project_id";--> statement-breakpoint

DELETE FROM "project_markdown_draft_contributors" WHERE "markdown_id" IS NULL;--> statement-breakpoint

ALTER TABLE "project_markdown_draft_contributors" ALTER COLUMN "markdown_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "project_markdown_draft_contributors" DROP CONSTRAINT IF EXISTS "project_readme_draft_contributors_pkey";--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors" DROP CONSTRAINT IF EXISTS "project_readme_draft_contributors_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors" DROP CONSTRAINT IF EXISTS "project_readme_draft_contributors_user_id_profiles_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "project_readme_draft_contributors_user_idx";--> statement-breakpoint

ALTER TABLE "project_markdown_draft_contributors" ADD CONSTRAINT "project_markdown_draft_contributors_pkey" PRIMARY KEY ("markdown_id", "user_id");--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors" ADD CONSTRAINT "project_markdown_draft_contributors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors" ADD CONSTRAINT "project_markdown_draft_contributors_markdown_id_project_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "project_markdowns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_markdown_draft_contributors" ADD CONSTRAINT "project_markdown_draft_contributors_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_markdown_draft_contributors_user_idx" ON "project_markdown_draft_contributors" ("user_id");--> statement-breakpoint


-- 5. Trigger to prevent deletion of baseline README.md (slug = 'readme')
CREATE OR REPLACE FUNCTION prevent_readme_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.slug = 'readme' THEN
        RAISE EXCEPTION 'The primary README.md document cannot be deleted.';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_readme_delete ON project_markdowns;--> statement-breakpoint
CREATE TRIGGER trg_prevent_readme_delete
BEFORE DELETE ON project_markdowns
FOR EACH ROW
EXECUTE FUNCTION prevent_readme_delete();
