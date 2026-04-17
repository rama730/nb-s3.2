import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import type { AuthSnapshot, AuthSnapshotResolution } from "@/lib/auth/snapshot";
import { resolveAuthSnapshot } from "@/lib/auth/snapshot";
import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/data/profile";

/**
 * SEC-M6: `ViewerAuthContext` is SERVER-ONLY. It holds the raw Supabase
 * client instance and the full `AuthSnapshot` (which contains `sessionId`,
 * `email`, `appMetadata`, `userMetadata`). Do NOT:
 *   - return this object from a Next.js server component (Next will attempt
 *     to serialize it to the client payload);
 *   - return it from a server action;
 *   - include it in a `jsonSuccess()` / `NextResponse.json()` body;
 *   - store it in a context provider that is passed to a `"use client"` tree.
 *
 * To hand a subset to the client, project into `toClientViewer()` which
 * enforces the whitelist: `{ userId, emailVerified, username, avatarUrl,
 * displayName, aal }`. New callers must extend the whitelist here, not in
 * ad-hoc places, so the redaction boundary stays in one file.
 */
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

/**
 * The minimal, client-safe projection of the viewer. Explicitly excludes
 * `sessionId`, raw user object, `appMetadata`, `userMetadata`, `email`, and
 * the Supabase client. Use this shape whenever a client component needs to
 * know "who is logged in."
 */
export type ClientViewer = {
  userId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** Authentication Assurance Level: 'aal1' | 'aal2' (MFA). Never raw session id. */
  aal: 'aal1' | 'aal2' | null;
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

/**
 * SEC-M6: project the server-only viewer context into the client-safe
 * `ClientViewer` shape. Callers that need to ship viewer data down to a
 * `"use client"` boundary MUST use this (or re-derive from its output)
 * instead of spreading the raw context — the raw context contains the
 * session id, raw app metadata, refresh artifacts, and a live Supabase
 * client that Next.js would happily attempt to serialize.
 *
 * The `aal` projection deliberately collapses unknown / null values to
 * `null` so a client check like `aal === 'aal2'` is never accidentally
 * satisfied by a malformed snapshot.
 */
export function toClientViewer(
  context: ViewerAuthContext | ViewerProfileContext,
): ClientViewer {
  const profile = 'profile' in context ? context.profile : null;
  const rawAal = (context.snapshot as unknown as { aal?: unknown })?.aal;
  const aal = rawAal === 'aal2' ? 'aal2' : rawAal === 'aal1' ? 'aal1' : null;
  return {
    userId: context.userId,
    username: profile?.username ?? null,
    displayName: profile?.fullName ?? profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    emailVerified: context.emailVerified,
    aal,
  };
}
