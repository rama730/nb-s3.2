-- ============================================================================
-- Project update drafts RLS
-- Drafts can contain unpublished project context, so direct table access is
-- limited to users who can create updates for the project.
-- ============================================================================

ALTER TABLE "project_update_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "Project update authors can manage own drafts" ON "project_update_drafts";
--> statement-breakpoint

CREATE POLICY "Project update authors can manage own drafts"
ON "project_update_drafts"
FOR ALL
USING (
    auth.uid() = "user_id"
    AND EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_update_drafts"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" pm
                  WHERE pm.project_id = p.id
                    AND pm.user_id = auth.uid()
                    AND pm.role IN ('owner', 'admin', 'member')
              )
          )
    )
)
WITH CHECK (
    auth.uid() = "user_id"
    AND EXISTS (
        SELECT 1
        FROM "projects" p
        WHERE p.id = "project_update_drafts"."project_id"
          AND p.deleted_at IS NULL
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM "project_members" pm
                  WHERE pm.project_id = p.id
                    AND pm.user_id = auth.uid()
                    AND pm.role IN ('owner', 'admin', 'member')
              )
          )
    )
);
