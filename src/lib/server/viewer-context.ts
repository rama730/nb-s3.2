import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/data/profile";

export type ViewerAuthContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User | null;
  userId: string | null;
};

export type ViewerProfileContext = ViewerAuthContext & {
  profile: Awaited<ReturnType<typeof getUserProfile>> | null;
};

const getSupabaseClient = cache(async () => createClient());

export const getViewerAuthContext = cache(async (): Promise<ViewerAuthContext> => {
  const supabase = await getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    supabase,
    user: user ?? null,
    userId: user?.id ?? null,
  };
});

export const getViewerProfileContext = cache(async (): Promise<ViewerProfileContext> => {
  const auth = await getViewerAuthContext();
  const profile = auth.userId ? await getUserProfile(auth.userId) : null;
  return {
    ...auth,
    profile,
  };
});
