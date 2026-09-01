"use client";

import { buildOAuthRedirectTo, resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { continueBrowserOAuthRedirect } from "@/lib/auth/oauth";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type GithubOAuthOptions = {
  nextPath?: string;
  scopes?: string;
  login?: string | null;
};

/**
 * Starts the one canonical GitHub repository-authorization flow.
 *
 * GitHub may already be linked as an identity while the short-lived repository
 * access grant is unavailable. `signInWithOAuth` refreshes that grant and lets
 * the callback persist it in the secure import-access cookie. Sync surfaces must
 * not call `linkIdentity` here: identity linking belongs to Settings.
 */
export async function startGithubRepositoryAuthorization({
  nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`,
  scopes = "repo user:email read:org",
  login,
}: GithubOAuthOptions = {}) {
  const destination = new URL(nextPath, window.location.origin);
  destination.searchParams.delete("githubAuth");
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `github-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const result = await createSupabaseBrowserClient().auth.signInWithOAuth({
    provider: "github",
    options: {
      scopes,
      queryParams: {
        prompt: "select_account",
        ...(login?.trim() ? { login: login.trim() } : {}),
      },
      redirectTo: buildOAuthRedirectTo(
        resolveAuthBaseUrl(),
        `${destination.pathname}${destination.search}${destination.hash}`,
        requestId,
        "github",
      ),
    },
  });
  if (result.error) throw result.error;
  if (!result.data?.url)
    throw new Error("GitHub authorization could not be started.");
  continueBrowserOAuthRedirect(result);
}
