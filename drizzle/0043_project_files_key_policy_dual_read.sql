-- project-files key policy hardening:
-- - canonical keys: <project_id>/<path> (write target)
-- - legacy keys: projects/<project_id>/<path> (read-only compatibility)

DROP POLICY IF EXISTS project_files_read ON storage.objects;
CREATE POLICY project_files_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-files'
  AND (
    (
      split_part(name, '/', 1) = 'projects'
      AND split_part(name, '/', 2) <> ''
      AND split_part(name, '/', 3) <> ''
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id::text = split_part(name, '/', 2)
          AND p.owner_id = auth.uid()
      )
    )
    OR (
      split_part(name, '/', 1) <> 'projects'
      AND split_part(name, '/', 1) <> ''
      AND split_part(name, '/', 2) <> ''
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id::text = split_part(name, '/', 1)
          AND p.owner_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.user_id = auth.uid()
        AND (
          (
            split_part(name, '/', 1) = 'projects'
            AND m.project_id::text = split_part(name, '/', 2)
          )
          OR (
            split_part(name, '/', 1) <> 'projects'
            AND m.project_id::text = split_part(name, '/', 1)
          )
        )
    )
  )
);

DROP POLICY IF EXISTS project_files_public_read ON storage.objects;
CREATE POLICY project_files_public_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-files'
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.visibility = 'public'
      AND (
        (
          split_part(name, '/', 1) = 'projects'
          AND split_part(name, '/', 2) <> ''
          AND split_part(name, '/', 3) <> ''
          AND p.id::text = split_part(name, '/', 2)
        )
        OR (
          split_part(name, '/', 1) <> 'projects'
          AND split_part(name, '/', 1) <> ''
          AND split_part(name, '/', 2) <> ''
          AND p.id::text = split_part(name, '/', 1)
        )
      )
  )
);

DROP POLICY IF EXISTS project_files_write ON storage.objects;
CREATE POLICY project_files_write ON storage.objects
FOR ALL
USING (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) <> 'projects'
  AND split_part(name, '/', 1) <> ''
  AND split_part(name, '/', 2) <> ''
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 1) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 1) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 1) <> 'projects'
  AND split_part(name, '/', 1) <> ''
  AND split_part(name, '/', 2) <> ''
  AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id::text = split_part(name, '/', 1) AND p.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id::text = split_part(name, '/', 1) AND m.user_id = auth.uid() AND m.role <> 'viewer'
    )
  )
);
