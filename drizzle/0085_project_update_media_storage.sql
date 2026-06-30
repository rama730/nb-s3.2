-- ============================================================================
-- Project update media storage
-- Keeps update image uploads isolated from project files and applies the same
-- project-scoped write guard used by the application upload intents.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'allowed_mime_types'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'project-updates-media',
      'project-updates-media',
      true,
      104857600,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSE
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('project-updates-media', 'project-updates-media', true, 104857600)
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
  END IF;

  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS project_updates_media_public_read ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS project_updates_media_write ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS project_updates_media_delete ON storage.objects';

  EXECUTE $policy$
    CREATE POLICY project_updates_media_public_read
    ON storage.objects FOR SELECT
    USING (bucket_id = 'project-updates-media')
  $policy$;

  EXECUTE $policy$
    CREATE POLICY project_updates_media_write
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'project-updates-media'
      AND split_part(name, '/', 1) = 'projects'
      AND split_part(name, '/', 2) <> ''
      AND (
        EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id::text = split_part(name, '/', 2)
            AND p.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.project_members m
          WHERE m.project_id::text = split_part(name, '/', 2)
            AND m.user_id = auth.uid()
            AND m.role <> 'viewer'
        )
      )
    )
  $policy$;

  EXECUTE $policy$
    CREATE POLICY project_updates_media_delete
    ON storage.objects FOR DELETE
    USING (
      bucket_id = 'project-updates-media'
      AND split_part(name, '/', 1) = 'projects'
      AND split_part(name, '/', 2) <> ''
      AND (
        EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id::text = split_part(name, '/', 2)
            AND p.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.project_members m
          WHERE m.project_id::text = split_part(name, '/', 2)
            AND m.user_id = auth.uid()
            AND m.role <> 'viewer'
        )
      )
    )
  $policy$;
END $$;
