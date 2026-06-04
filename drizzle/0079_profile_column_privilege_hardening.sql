-- ============================================================================
-- Profile column privilege hardening
--
-- RLS decides which profile rows a browser API role may see, but broad table
-- SELECT grants still expose every column on those visible rows. Keep the
-- public API limited to display/profile-routing fields and force private
-- fields such as email and notification preferences through authenticated
-- server-side reads.
-- ============================================================================

REVOKE SELECT ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;
--> statement-breakpoint

GRANT SELECT (
  id,
  username,
  full_name,
  avatar_url,
  banner_url,
  bio,
  headline,
  location,
  website,
  skills,
  interests,
  experience,
  education,
  open_to,
  availability_status,
  social_links,
  visibility,
  message_privacy,
  connection_privacy,
  created_at,
  updated_at,
  deleted_at,
  connections_count,
  projects_count,
  followers_count,
  last_active_at
) ON TABLE public.profiles TO anon, authenticated;
--> statement-breakpoint
