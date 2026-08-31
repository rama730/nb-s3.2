-- Reconcile server-owned task tables that exist in the application schema but
-- were never created by immutable migration history.

CREATE TABLE IF NOT EXISTS public.task_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  message text,
  files_count integer NOT NULL DEFAULT 0,
  pushed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pushed_at timestamptz NOT NULL DEFAULT now(),
  files_json jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS task_pushes_task_idx
  ON public.task_pushes (task_id);
CREATE INDEX IF NOT EXISTS task_pushes_task_pushed_at_idx
  ON public.task_pushes (task_id, pushed_at DESC);
CREATE INDEX IF NOT EXISTS task_pushes_project_idx
  ON public.task_pushes (project_id);
CREATE INDEX IF NOT EXISTS task_pushes_pushed_by_idx
  ON public.task_pushes (pushed_by);

ALTER TABLE public.task_pushes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.task_read_receipts (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_read_receipts_pkey PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_read_receipts_user_task
  ON public.task_read_receipts (user_id, task_id);

ALTER TABLE public.task_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprint_task_memberships ENABLE ROW LEVEL SECURITY;

-- These are the three missing FK-leading indexes reported by the live advisor.
CREATE INDEX IF NOT EXISTS sprint_task_memberships_added_by_idx
  ON public.sprint_task_memberships (added_by);
CREATE INDEX IF NOT EXISTS sprint_task_memberships_project_id_idx
  ON public.sprint_task_memberships (project_id);
CREATE INDEX IF NOT EXISTS sprint_task_memberships_removed_by_idx
  ON public.sprint_task_memberships (removed_by);
