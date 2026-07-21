-- Ponytail storage contracts:
-- - keep update media intentionally public and image-only
-- - stop project/task file buckets from being completely MIME-unrestricted

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/octet-stream',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
WHERE id IN ('project-files', 'task-files');

UPDATE storage.buckets
SET
  public = true,
  file_size_limit = 104857600,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
WHERE id = 'project-updates-media';
