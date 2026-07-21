-- Keep normalized role-skill assignments inside the same visibility boundary
-- as the project and role they describe.
DROP POLICY IF EXISTS "Role skills are publicly readable" ON "role_skills";
DROP POLICY IF EXISTS "Visible role skills are readable" ON "role_skills";
CREATE POLICY "Visible role skills are readable"
ON "role_skills" FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "project_open_roles" role
        INNER JOIN "projects" project ON project."id" = role."project_id"
        WHERE role."id" = "role_skills"."role_id"
          AND project."deleted_at" IS NULL
          AND (
              project."visibility" IN ('public', 'unlisted')
              OR project."owner_id" = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" member
                  WHERE member."project_id" = project."id"
                    AND member."user_id" = auth.uid()
              )
          )
    )
);
