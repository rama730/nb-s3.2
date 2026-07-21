import type { User } from "@supabase/supabase-js";
import {
  buildAccountProviderStates,
  formatAccountProviderLabel,
  getLinkedAccountProviders,
  resolvePasswordCredentialState,
  resolvePrimaryProvider,
  type AccountAuthProvider,
} from "@/lib/auth/account-identity";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import type { AuthConnectionMethod, ExternalAccountHealth, GithubServiceConnection, IntegrationsData } from "@/lib/types/settingsTypes";

type BuildIntegrationsDataInput = {
  user: User;
  githubRepoProjectCount: number;
  githubLastSyncAt: string | null;
  passwordLastChangedAt: string | null;
  githubAccountHealth?: ExternalAccountHealth;
};

function normalizeProvider(value: string | null): AccountAuthProvider | null {
  return value === "google" || value === "github" || value === "email" ? value : null;
}

function providerDetail(input: {
  provider: AccountAuthProvider;
  label: string;
  state: AuthConnectionMethod["state"];
  hasPassword: boolean;
  email: string | null;
  emailVerified: boolean;
}) {
  if (input.provider === "email") {
    if (input.state !== "not_linked") return {
      detail: input.state === "primary" ? "This account was created with email." : "Email sign-in is enabled on this account.",
      secondaryDetail: input.hasPassword ? input.email : "No password credential is currently available.",
    };
    return {
      detail: "Email sign-in is not enabled on this account.",
      secondaryDetail: input.email
        ? input.emailVerified ? `Set a password in Security to enable email sign-in for ${input.email}.` : `Verify ${input.email} before enabling email sign-in.`
        : null,
    };
  }
  return {
    detail: input.state === "primary"
      ? `This account was created with ${input.label}.`
      : input.state === "linked"
        ? `${input.label} is attached as an additional sign-in method.`
        : `${input.label} is not attached to this account.`,
    secondaryDetail: null,
  };
}

function githubService(input: {
  linked: boolean;
  count: number;
  lastSyncAt: string | null;
  username: string | null;
  health: ExternalAccountHealth;
}): GithubServiceConnection {
  const username = input.health.profile?.username ?? input.username;
  const unavailable = input.health.state === "unavailable";
  const status = unavailable ? "action_required" : input.count > 0 && input.linked ? "connected" : input.linked ? "available" : "not_connected";
  const summary = unavailable
    ? "GitHub account unavailable."
    : input.count > 0
      ? `Used by ${input.count} project${input.count === 1 ? "" : "s"}.`
      : input.linked ? "GitHub is linked; no project uses repository access yet." : "GitHub is not linked.";
  const detail = unavailable
    ? `GitHub could not find${username ? ` @${username}` : " the linked account"}. Imported project data remains available.`
    : input.count > 0
      ? "Open a project to manage repository import and synchronization."
      : "Repository access becomes active when you connect GitHub from a project.";
  return { status, summary, detail, usageCount: input.count, lastUsedAt: input.lastSyncAt, githubUsername: username };
}

export function buildIntegrationsData(input: BuildIntegrationsDataInput): IntegrationsData {
  const github = buildGithubAccountConnectionState(input.user);
  const email = typeof input.user.email === "string" && input.user.email.trim() ? input.user.email : null;
  const emailVerified = isEmailVerified(input.user);
  const hasPassword = resolvePasswordCredentialState(input.user, input.passwordLastChangedAt);
  const linked = getLinkedAccountProviders(input.user);
  const providers = hasPassword && !linked.includes("email") ? [...linked, "email" as const] : linked;
  const primary = normalizeProvider(resolvePrimaryProvider(input.user));
  const createdWith = providers.find((provider) => provider === primary) ?? null;
  const createdWithLabel = formatAccountProviderLabel(createdWith);
  const additionalLinkedCount = Math.max(providers.length - (createdWith ? 1 : 0), 0);
  const health = input.githubAccountHealth ?? { state: github.linked ? "unknown" as const : "not_linked" as const, reason: github.linked ? "provider_error" as const : "not_linked" as const, checkedAt: null, profile: null };

  const authConnections = buildAccountProviderStates(input.user).map((entry): AuthConnectionMethod => {
    const state = entry.provider === "email" && hasPassword ? (primary === "email" ? "primary" : "linked") : entry.state;
    return { provider: entry.provider, label: entry.label, state, ...providerDetail({ provider: entry.provider, label: entry.label, state, hasPassword, email, emailVerified }) };
  });

  return {
    summary: createdWith
      ? `Account created with ${createdWithLabel}. ${additionalLinkedCount} additional sign-in method${additionalLinkedCount === 1 ? " is" : "s are"} linked.`
      : `${providers.length} sign-in method${providers.length === 1 ? " is" : "s are"} linked.`,
    authConnections,
    githubService: githubService({ linked: github.linked, count: input.githubRepoProjectCount, lastSyncAt: input.githubLastSyncAt, username: github.username, health }),
  };
}
