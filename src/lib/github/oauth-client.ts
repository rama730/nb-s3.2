"use client";

import { buildOAuthRedirectTo, resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { continueBrowserOAuthRedirect } from "@/lib/auth/oauth";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type GithubOAuthOptions = {
  nextPath?: string;
  scopes?: string;
  login?: string | null;
};

type GithubIdentityLinkOptions = Pick<GithubOAuthOptions, "nextPath"> & {
  beforeRedirect?: () => Promise<void>;
};

const GITHUB_REPOSITORY_SCOPES = "repo workflow user:email read:org";

function createGithubOAuthRequestId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `github-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function identityLinkError(error: unknown, provider = "GitHub") {
  const record = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown }
    : null;
  const code = typeof record?.code === "string" ? record.code.trim().toLowerCase() : "";
  const message = typeof record?.message === "string" ? record.message.trim() : "";
  if (code === "manual_linking_disabled" || message.toLowerCase().includes("manual linking is disabled")) {
    return new Error(
      `${provider} linking is unavailable because manual identity linking is disabled for this deployment. An administrator must enable Allow manual linking in Supabase Auth, then try again.`,
    );
  }
  return error instanceof Error ? error : new Error(`Failed to link ${provider}`);
}

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
  // ponytail: one canonical grant covers repository contents and the workflow
  // files GitHub protects with its separate OAuth scope.
  scopes = GITHUB_REPOSITORY_SCOPES,
  login,
}: GithubOAuthOptions = {}) {
  const destination = new URL(nextPath, window.location.origin);
  destination.searchParams.delete("githubAuth");
  const requestId = createGithubOAuthRequestId();
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

/**
 * Links a GitHub identity to the currently authenticated NetworkBase account. Unlike
 * repository reauthorization, this must use Supabase identity linking so OAuth
 * can never sign the browser into a different NetworkBase account.
 */
export async function startGithubIdentityLink({
  nextPath = "/settings?tab=integrations&githubIdentity=linked",
  beforeRedirect,
}: GithubIdentityLinkOptions = {}) {
  const destination = new URL(nextPath, window.location.origin);
  destination.searchParams.delete("githubAuth");
  const result = await createSupabaseBrowserClient().auth.linkIdentity({
    provider: "github",
    options: {
      scopes: GITHUB_REPOSITORY_SCOPES,
      queryParams: { prompt: "select_account" },
      // ponytail: obtain the provider URL first so replacement can detach the
      // stale identity only after Auth has accepted the link request.
      skipBrowserRedirect: true,
      redirectTo: buildOAuthRedirectTo(
        resolveAuthBaseUrl(),
        `${destination.pathname}${destination.search}${destination.hash}`,
        createGithubOAuthRequestId(),
        "github",
      ),
    },
  });
  if (result.error) throw identityLinkError(result.error);
  if (!result.data?.url) throw new Error("GitHub account linking could not be started.");
  await beforeRedirect?.();
  window.location.assign(result.data.url);
}
