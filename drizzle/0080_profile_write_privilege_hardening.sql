-- ============================================================================
-- Profile write privilege hardening
--
-- Profile writes carry private fields, derived counters, and auth-owned data.
-- Keep the browser API read-only for approved display columns and route writes
-- through server-side actions that use the application database connection.
-- ============================================================================

REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
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
