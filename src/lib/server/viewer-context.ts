import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import type { AuthSnapshot, AuthSnapshotResolution } from "@/lib/auth/snapshot";
import { resolveAuthSnapshot } from "@/lib/auth/snapshot";
import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/data/profile";

export type ViewerAuthContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  snapshot: AuthSnapshot | null;
  user: User | null;
  userId: string | null;
  emailVerified: boolean;
};

export type ViewerProfileContext = ViewerAuthContext & {
  profile: Awaited<ReturnType<typeof getUserProfile>> | null;
};

const getSupabaseClient = cache(async () => createClient());
type AuthSnapshotAwareClient = Awaited<ReturnType<typeof createClient>> & {
  __resolveAuthSnapshot?: () => Promise<AuthSnapshotResolution>;
};

async function getAuthResolution(client: Awaited<ReturnType<typeof createClient>>) {
  const awareClient = client as AuthSnapshotAwareClient;
  if (awareClient.__resolveAuthSnapshot) {
    return awareClient.__resolveAuthSnapshot();
  }
  return resolveAuthSnapshot(client);
}

export const getViewerAuthContext = cache(async (): Promise<ViewerAuthContext> => {
  const supabase = await getSupabaseClient();
  const { snapshot, user } = await getAuthResolution(supabase);

  return {
    supabase,
    snapshot,
    user: user ?? null,
    userId: user?.id ?? null,
    emailVerified: snapshot?.emailVerified ?? false,
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
