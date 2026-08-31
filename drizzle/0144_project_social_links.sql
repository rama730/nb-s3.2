ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS external_links jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS external_link_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS social_link_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
