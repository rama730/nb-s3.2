-- Drop legacy task_files table and related objects.
-- This project now uses project_nodes + task_node_links for all file attachments.

DROP TABLE IF EXISTS public.task_files CASCADE;

