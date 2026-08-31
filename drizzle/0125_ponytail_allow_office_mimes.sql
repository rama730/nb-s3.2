-- Ponytail storage contracts fix: Allow Office Documents and ZIP files

UPDATE storage.buckets
SET
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
    'image/gif',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/zip',
    'application/x-zip-compressed'
  ]::text[]
WHERE id IN ('project-files', 'task-files');
