CREATE TABLE IF NOT EXISTS public.project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  role_id uuid REFERENCES public.project_open_roles(id) ON DELETE SET NULL,
  role_title text,
  guidance_label text,
  note text,
  project_title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  review_at timestamptz,
  idempotency_key text,
  message_workflow_item_id uuid,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_invitations_kind_check
    CHECK (kind IN ('ordinary_role', 'guidance_appointment')),
  CONSTRAINT project_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  CONSTRAINT project_invitations_snapshot_check
    CHECK (
      (kind = 'ordinary_role' AND role_title IS NOT NULL AND guidance_label IS NULL)
      OR (kind = 'guidance_appointment' AND guidance_label IS NOT NULL AND role_id IS NULL)
    )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_invitations_project_candidate_idx
  ON public.project_invitations (project_id, candidate_id, status, created_at);
CREATE INDEX IF NOT EXISTS project_invitations_candidate_inbox_idx
  ON public.project_invitations (candidate_id, status, created_at);
CREATE INDEX IF NOT EXISTS project_invitations_expires_idx
  ON public.project_invitations (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_invitations_idempotency_unique
  ON public.project_invitations (inviter_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_invitations_pending_ordinary_unique
  ON public.project_invitations (project_id, candidate_id)
  WHERE kind = 'ordinary_role' AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS project_invitations_pending_guidance_unique
  ON public.project_invitations (project_id)
  WHERE kind = 'guidance_appointment' AND status = 'pending';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.project_guidance_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  guide_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL REFERENCES public.project_invitations(id) ON DELETE RESTRICT,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  review_at timestamptz,
  public_attribution_consent boolean NOT NULL DEFAULT false,
  previous_membership_role text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_guidance_appointments_status_check
    CHECK (status IN ('active', 'ended', 'revoked')),
  CONSTRAINT project_guidance_appointments_previous_membership_role_check
    CHECK (previous_membership_role IS NULL OR previous_membership_role IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_guidance_appointments_project_guide_idx
  ON public.project_guidance_appointments (project_id, guide_user_id, status);
CREATE INDEX IF NOT EXISTS project_guidance_appointments_guide_active_idx
  ON public.project_guidance_appointments (guide_user_id, accepted_at)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS project_guidance_appointments_active_project_unique
  ON public.project_guidance_appointments (project_id)
  WHERE status = 'active';
--> statement-breakpoint

-- Browser clients may only read invitations that concern them or a project
-- they already belong to. Creation and every state transition remain in the
-- shared server command; no client write policy is deliberately provided.
ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_invitations_read_authorized ON public.project_invitations;
CREATE POLICY project_invitations_read_authorized
ON public.project_invitations FOR SELECT TO authenticated
USING (
  candidate_id = auth.uid()
  OR inviter_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.projects
    WHERE projects.id = project_invitations.project_id
      AND projects.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_members
    WHERE project_members.project_id = project_invitations.project_id
      AND project_members.user_id = auth.uid()
  )
);
--> statement-breakpoint

-- An appointment is visible to its appointee and project participants. It is
-- publicly attributable only when the appointee explicitly consented and the
-- project itself is public. As above, mutations use the server command only.
ALTER TABLE public.project_guidance_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_guidance_appointments_read_authorized ON public.project_guidance_appointments;
CREATE POLICY project_guidance_appointments_read_authorized
ON public.project_guidance_appointments FOR SELECT TO authenticated
USING (
  guide_user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.projects
    WHERE projects.id = project_guidance_appointments.project_id
      AND projects.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_members
    WHERE project_members.project_id = project_guidance_appointments.project_id
      AND project_members.user_id = auth.uid()
  )
  OR (
    public_attribution_consent
    AND EXISTS (
      SELECT 1
      FROM public.projects
      WHERE projects.id = project_guidance_appointments.project_id
        AND projects.visibility = 'public'
        AND projects.deleted_at IS NULL
    )
  )
);
