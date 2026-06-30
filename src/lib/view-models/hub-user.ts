import type { User as AuthUser } from "@supabase/supabase-js";

import type { User as HubUser } from "@/types/hub";

export function toHubUser(user: AuthUser | null, fallback: HubUser | null): HubUser | null {
  if (!user) return fallback;
  return {
    id: user.id,
    email: user.email,
    username: typeof user.user_metadata?.username === "string" ? user.user_metadata.username : undefined,
    fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined,
    avatarUrl: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined,
  };
}
