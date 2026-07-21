-- Custom Opportunity Preference Columns for profiles
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "open_to_custom_roles" text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "preferred_categories" text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS "profiles_custom_roles_gin_idx" ON "profiles" USING gin ("open_to_custom_roles");

-- Matchmaking Attributes for projectOpenRoles
ALTER TABLE "project_open_roles" ADD COLUMN IF NOT EXISTS "commitment_type" text;
ALTER TABLE "project_open_roles" ADD COLUMN IF NOT EXISTS "experience_required" text;
ALTER TABLE "project_open_roles" ADD COLUMN IF NOT EXISTS "hours_per_week" text;

-- Project-to-Project application support and indexes for roleApplications
ALTER TABLE "role_applications" ADD COLUMN IF NOT EXISTS "applying_project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "role_applications" ADD COLUMN IF NOT EXISTS "applying_project_role" text;
CREATE UNIQUE INDEX IF NOT EXISTS "role_applicant_uniq_idx" ON "role_applications" ("role_id", "applicant_id");

-- Add open_roles_count column to projects table to enable materialized O(1) checks for active vacancies
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "open_roles_count" integer NOT NULL DEFAULT 0;

-- Sync function to keep projects.open_roles_count in sync with project_open_roles mutations
CREATE OR REPLACE FUNCTION sync_project_open_roles_count()
RETURNS TRIGGER AS $$
DECLARE
    p_id uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        p_id := OLD.project_id;
    ELSE
        p_id := NEW.project_id;
    END IF;

    UPDATE projects 
    SET open_roles_count = (
        SELECT COALESCE(COUNT(*), 0)
        FROM project_open_roles
        WHERE project_id = p_id AND filled < count
    )
    WHERE id = p_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it already exists
DROP TRIGGER IF EXISTS trigger_sync_project_open_roles_count ON project_open_roles;

-- Create AFTER trigger to update projects.open_roles_count automatically
CREATE TRIGGER trigger_sync_project_open_roles_count
AFTER INSERT OR UPDATE OR DELETE ON project_open_roles
FOR EACH ROW
EXECUTE FUNCTION sync_project_open_roles_count();

-- Backfill open_roles_count for all existing projects
UPDATE projects p
SET open_roles_count = (
    SELECT COALESCE(COUNT(*), 0)
    FROM project_open_roles r
    WHERE r.project_id = p.id AND r.filled < r.count
);
