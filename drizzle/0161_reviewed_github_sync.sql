ALTER TABLE public.file_versions ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}';

CREATE TABLE public.github_sync_connections (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  repository text NOT NULL, repository_id bigint NOT NULL, branch text NOT NULL,
  version integer NOT NULL DEFAULT 1, installation_id bigint, incoming_sha text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.github_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review','queued','running','completed','failed','needs_review','cancelled')),
  stage text NOT NULL DEFAULT 'Ready for review', manifest jsonb NOT NULL, result jsonb NOT NULL DEFAULT '{}',
  credential jsonb, error text, lease_id uuid, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_sync_runs_project_idx ON public.github_sync_runs(project_id, created_at DESC);
CREATE INDEX github_sync_runs_queue_idx ON public.github_sync_runs(status, updated_at);
CREATE UNIQUE INDEX github_sync_runs_active_idx ON public.github_sync_runs(project_id) WHERE status IN ('queued','running');
CREATE TABLE public.github_sync_files (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repository_id bigint NOT NULL, branch text NOT NULL, path text NOT NULL,
  node_id uuid REFERENCES public.project_nodes(id) ON DELETE SET NULL,
  blob_sha text, local_hash text, local_blob_sha text, commit_sha text NOT NULL, sequence bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, repository_id, branch, path)
);
CREATE INDEX github_sync_files_node_idx ON public.github_sync_files(node_id);
CREATE TABLE public.github_contributor_identities (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  github_id bigint NOT NULL, login text NOT NULL, name text NOT NULL, email text NOT NULL,
  avatar_url text, approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX github_contributor_identity_uidx ON public.github_contributor_identities(github_id);

-- Server actions perform authorization. Never expose sealed credentials or commit emails via PostgREST.
ALTER TABLE public.github_sync_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_contributor_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.github_sync_connections, public.github_sync_runs, public.github_sync_files, public.github_contributor_identities FROM anon, authenticated;
GRANT ALL ON public.github_sync_connections, public.github_sync_runs, public.github_sync_files, public.github_contributor_identities TO service_role;

-- Capture evidence at the canonical persistence boundary, including active-version saves.
-- This deliberately does not mutate membership, profile visibility, or role history.
CREATE OR REPLACE FUNCTION public.record_file_content_contribution() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE project_uuid uuid; event_sequence bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND (NEW.uploaded_by IS DISTINCT FROM auth.uid() OR NEW.attribution <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'File authorship must match the authenticated actor';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
    AND (NEW.content_hash IS NOT NULL OR NEW.s3_key IS NOT DISTINCT FROM OLD.s3_key) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.content_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.file_versions previous WHERE previous.node_id=NEW.node_id
      AND previous.version=NEW.version-1 AND previous.content_hash=NEW.content_hash
  ) THEN RETURN NEW; END IF;
  SELECT project_id INTO project_uuid FROM public.project_nodes WHERE id = NEW.node_id;
  UPDATE public.projects SET current_sequence_number = current_sequence_number + 1
    WHERE id = project_uuid RETURNING current_sequence_number INTO event_sequence;
  INSERT INTO public.project_node_events(project_id,node_id,actor_id,type,sequence_number,metadata)
  VALUES (project_uuid,NEW.node_id,NEW.uploaded_by,'file_content_contributed',event_sequence,
    jsonb_build_object('version',NEW.version,'hash',NEW.content_hash,'source',COALESCE(NEW.attribution->>'source','edge'),'attribution',NEW.attribution));
  UPDATE public.profile_collaboration_summaries SET stale=true,updated_at=now() WHERE profile_id=NEW.uploaded_by;
  RETURN NEW;
END $$;
CREATE TRIGGER file_content_contribution AFTER INSERT OR UPDATE ON public.file_versions
  FOR EACH ROW EXECUTE FUNCTION public.record_file_content_contribution();
