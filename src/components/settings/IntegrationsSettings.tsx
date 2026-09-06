"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Code2, Copy, ExternalLink, GitBranch, Github, KeyRound, Link2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useExtensionSessionsData, useIntegrationsData } from "@/hooks/useSettingsQueries";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { identityLinkError, startGithubIdentityLink } from "@/lib/github/oauth-client";
import { GitHubCommitAttributionSettings } from "@/components/settings/GitHubCommitAttributionSettings";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { revokeExtensionSession, generateExtensionToken } from "@/app/actions/extension-sessions";
import type { AuthConnectionMethod, ExtensionSessionData, ExtensionSessionsData, IntegrationsAuthProvider } from "@/lib/types/settingsTypes";

const PROVIDER_ICONS: Partial<Record<IntegrationsAuthProvider, string>> = {
  google: "/skill-icons/v1/logos-google-icon.svg",
  github: "/skill-icons/v1/github.svg",
};

function ProviderIcon({ provider }: { provider: IntegrationsAuthProvider }) {
  const src = PROVIDER_ICONS[provider];
  return src
    ? <Image src={src} alt="" width={32} height={32} unoptimized className="h-8 w-8 rounded-lg object-contain" />
    : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800"><Mail className="h-4 w-4" /></span>;
}

function ProviderRow({ provider, linking, onLink }: { provider: AuthConnectionMethod; linking: boolean; onLink: () => void }) {
  return <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
    <div className="flex min-w-0 gap-3">
      <ProviderIcon provider={provider.provider} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{provider.label}</h3><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs capitalize dark:bg-zinc-800">{provider.state.replace("_", " ")}</span></div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{provider.detail}</p>
        {provider.secondaryDetail ? <p className="mt-1 text-xs text-zinc-500">{provider.secondaryDetail}</p> : null}
      </div>
    </div>
    {provider.state === "not_linked" && provider.provider !== "email" ? <Button size="sm" variant="outline" onClick={onLink} disabled={linking}>{linking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Link</Button> : null}
    {provider.state === "not_linked" && provider.provider === "email" ? <Button size="sm" variant="outline" asChild><Link href="/settings?tab=security" prefetch={false}>Set password</Link></Button> : null}
  </div>;
}

const IDE_ICON_ASSETS: Record<string, string> = {
  vscode: "/ide-icons/vscode.png",
  cursor: "/ide-icons/cursor.png",
  windsurf: "/ide-icons/windsurf.svg",
  antigravity: "/ide-icons/antigravity.png",
};

function resolveIDEIcon(session: ExtensionSessionData) {
  const name = (session.editorName || session.deviceName || "").toLowerCase();
  if (name.includes("cursor")) return IDE_ICON_ASSETS.cursor;
  if (name.includes("windsurf")) return IDE_ICON_ASSETS.windsurf;
  if (name.includes("antigravity")) return IDE_ICON_ASSETS.antigravity;
  if (name.includes("code") || name.includes("vscode")) return IDE_ICON_ASSETS.vscode;
  return null;
}

function formatPlatform(platform: string) {
  const p = platform.toLowerCase();
  if (p === "darwin" || p === "mac" || p === "macos") return "macOS";
  if (p === "win32" || p === "windows" || p === "win") return "Windows";
  if (p === "linux") return "Linux";
  return platform;
}


function ExtensionSessionRow({ session, revoking, onRevoke }: { session: ExtensionSessionData; revoking: boolean; onRevoke: () => void }) {
  const isPending = session.clientVersion === "pending" || (!session.editorPlatform && !session.editorName);
  const ideIcon = !isPending ? resolveIDEIcon(session) : null;
  const platform = isPending
    ? null
    : session.editorPlatform
      ? formatPlatform(session.editorPlatform)
      : "Connected";
  const title = isPending
    ? session.deviceName?.trim() || "Manual authentication token"
    : session.editorName?.trim() || session.deviceName?.trim() || "Editor extension";

  return (
    <div className="flex items-center justify-between gap-4 border-b p-4 last:border-b-0 transition hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
      <div className="flex min-w-0 items-center gap-4">
        {ideIcon ? (
          <Image src={ideIcon} alt="" width={32} height={32} unoptimized className="h-8 w-8 shrink-0 object-contain" />
        ) : isPending ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 border border-amber-200 text-amber-600 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-400">
            <KeyRound className="h-4 w-4" />
          </span>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-100 border dark:bg-zinc-900 dark:border-zinc-800">
            <Code2 className="h-4 w-4 text-zinc-500" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{title}</p>
            {isPending ? (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                Awaiting connection
              </span>
            ) : platform ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {platform}
              </span>
            ) : null}
          </div>
          {isPending ? (
            <>
              <p className="truncate text-xs text-zinc-500 mt-1">
                Created {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })} · Awaiting initial connection from your editor
              </p>
              <p className="truncate text-[11px] text-zinc-400 mt-0.5">
                Manual fallback token · Paste token into your editor to complete sign-in
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-xs text-zinc-500 mt-1">
                Active {formatDistanceToNow(new Date(session.lastSeenAt), { addSuffix: true })} · v{session.clientVersion || "unknown"}
              </p>
              <p className="truncate text-[11px] text-zinc-400 mt-0.5">
                {session.authMethod === "web_login" ? "Web login" : "Manual token"}
                {session.editorVersion ? ` · ${session.editorVersion}` : ""}
              </p>
            </>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRevoke}
        disabled={revoking}
        className="text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
      >
        {revoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {revoking ? "Revoking..." : isPending ? "Revoke token" : "Disconnect"}
      </Button>
    </div>
  );
}

export default function IntegrationsSettings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useIntegrationsData();
  const { data: sessionData, isLoading: sessionsLoading, refetch: refetchSessions } = useExtensionSessionsData();
  const [linking, setLinking] = useState<IntegrationsAuthProvider | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showTokenGen, setShowTokenGen] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [replacementConfirmOpen, setReplacementConfirmOpen] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [replacementMethods, setReplacementMethods] = useState<Array<"totp" | "recovery_code" | "password">>([]);
  const [replacementFactorId, setReplacementFactorId] = useState<string | undefined>();
  const [replacingGithub, setReplacingGithub] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);

  const allSessions = sessionData?.sessions || [];
  const activeSessions = allSessions.filter((s) => s.clientVersion !== "pending" && (s.editorPlatform || s.editorName));
  const pendingSessions = allSessions.filter((s) => s.clientVersion === "pending" || (!s.editorPlatform && !s.editorName));

  useEffect(() => {
    const outcome = searchParams.get("githubIdentity");
    if (!outcome) return;
    if (outcome === "replaced") {
      toast.success("GitHub account replaced");
    } else if (outcome === "linked") {
      toast.success("GitHub account linked");
    } else if (outcome === "already_linked") {
      toast.info("This GitHub account is already linked.");
    } else if (outcome === "error") {
      const desc = searchParams.get("githubErrorDesc");
      toast.error(desc || "Could not link GitHub account. Please try again.");
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("githubIdentity");
    next.delete("githubErrorDesc");
    router.replace(`/settings?${next.toString()}`, { scroll: false });
    void refetch();
  }, [refetch, router, searchParams]);

  // ponytail: auto-reconcile live connection when manual token has been generated
  useEffect(() => {
    if (!generatedToken || !showTokenGen) return;

    const interval = setInterval(async () => {
      const res = await refetchSessions();
      const current = res.data?.sessions || [];
      const newActiveCount = current.filter((s) => s.clientVersion !== "pending" && (s.editorPlatform || s.editorName)).length;
      if (newActiveCount > activeSessions.length) {
        toast.success("Editor connected successfully!");
        setGeneratedToken(null);
        setShowTokenGen(false);
        setDeviceLabel("");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [generatedToken, showTokenGen, refetchSessions, activeSessions.length]);

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    try {
      const label = deviceLabel.trim() || "Manual authentication token";
      const result = await generateExtensionToken(label);
      if (result.success && result.rawToken) {
        setGeneratedToken(result.rawToken);
        await refetchSessions();
      } else {
        toast.error(result.error || "Failed to generate token");
      }
    } catch {
      toast.error("Failed to generate token");
    } finally {
      setGeneratingToken(false);
    }
  };

  const linkProvider = async (provider: "google" | "github") => {
    setLinking(provider);
    try {
      if (provider === "github") {
        await startGithubIdentityLink();
        return;
      }
      const { error: linkError } = await createSupabaseBrowserClient().auth.linkIdentity({ provider, options: { redirectTo: `${window.location.origin}/settings?tab=integrations` } });
      if (linkError) throw identityLinkError(linkError, "Google");
    } catch (linkError) {
      toast.error(linkError instanceof Error ? linkError.message : `Failed to link ${provider}`);
      setLinking(null);
    }
  };

  const requestReplacementVerification = async () => {
    try {
      const response = await fetch("/api/v1/auth/security-step-up");
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "Could not load verification options");
      }
      const methods = Array.isArray(payload?.data?.availableMethods)
        ? payload.data.availableMethods.filter(
            (method: unknown): method is "totp" | "recovery_code" | "password" =>
              method === "totp" || method === "recovery_code" || method === "password",
          )
        : [];
      if (!methods.length) {
        toast.error("Add a password or authenticator in Security before replacing GitHub");
        return;
      }
      setReplacementMethods(methods);
      setReplacementFactorId(
        typeof payload?.data?.primaryTotpFactorId === "string"
          ? payload.data.primaryTotpFactorId
          : undefined,
      );
      setReplacementConfirmOpen(false);
      setStepUpOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start account replacement");
    }
  };

  const replaceGithubAccount = async () => {
    setReplacingGithub(true);
    try {
      await startGithubIdentityLink({
        nextPath: "/settings?tab=integrations&githubIdentity=replaced",
        beforeRedirect: async () => {
          const response = await fetch("/api/v1/github/account/replacement", { method: "POST" });
          const payload = await response.json().catch(() => null);
          if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || "The unavailable GitHub account could not be detached");
          }
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not replace GitHub account");
      setReplacingGithub(false);
      void refetch();
    }
  };

  const revoke = async (sessionId: string) => {
    setRevoking(sessionId);

    // ponytail: optimistic cache update - immediately remove row for 0ms perceived lag
    const previousSessions = queryClient.getQueryData<ExtensionSessionsData>(queryKeys.settings.extensionSessions());
    if (previousSessions) {
      queryClient.setQueryData<ExtensionSessionsData>(queryKeys.settings.extensionSessions(), {
        ...previousSessions,
        sessions: previousSessions.sessions.filter((s) => s.id !== sessionId),
      });
    }

    try {
      const result = await revokeExtensionSession(sessionId);
      if (result.success) {
        toast.success("Editor session revoked");
        void refetchSessions();
        if (result.disconnectUri) {
          window.location.assign(result.disconnectUri);
        }
      } else {
        if (previousSessions) {
          queryClient.setQueryData(queryKeys.settings.extensionSessions(), previousSessions);
        }
        toast.error(result.error || "Could not revoke editor session");
      }
    } catch {
      if (previousSessions) {
        queryClient.setQueryData(queryKeys.settings.extensionSessions(), previousSessions);
      }
      toast.error("Could not revoke editor session");
    } finally {
      setRevoking(null);
    }
  };

  return <div className="space-y-6">
    <SettingsPageHeader title="Integrations" description="Manage sign-in methods, GitHub access, and active editor sessions." />
    {error ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{error instanceof Error ? error.message : "Unable to load integrations"}</p> : null}

    <SettingsSectionCard title="Account connections" description={data?.summary || "Sign-in methods attached to this account."}>
      {isLoading ? <div className="h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" /> : <div className="space-y-3">{data?.authConnections.map((provider) => <ProviderRow key={provider.provider} provider={provider} linking={linking === provider.provider} onLink={() => void linkProvider(provider.provider as "google" | "github")} />)}</div>}
    </SettingsSectionCard>

    <SettingsSectionCard title="GitHub" description="Repository access is managed from each project; this page only shows account-level status.">
      <div className="space-y-4">
        <GitHubCommitAttributionSettings />
        <div className="rounded-xl border p-4 transition-all">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Github className="h-8 w-8 shrink-0" />
            <div>
              <p className="text-sm font-semibold">{data?.githubService.summary || "GitHub status unavailable"}</p>
              <p className="mt-1 text-sm text-zinc-500">{data?.githubService.detail}</p>
              {data?.githubService.githubUsername ? (
                <a
                  href={`https://github.com/${data.githubService.githubUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs text-primary hover:underline"
                >
                  @{data.githubService.githubUsername}
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {data?.githubService.recoveryAction === "replace_account" ? (
              <Button size="sm" onClick={() => setReplacementConfirmOpen(true)} disabled={replacingGithub}>
                {replacingGithub ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Replace GitHub account
              </Button>
            ) : null}
            {data?.githubService.recoveryAction === "add_fallback_sign_in" ? (
              <Button size="sm" onClick={() => void linkProvider("google")} disabled={linking === "google"}>
                {linking === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Link Google first
              </Button>
            ) : null}
            {data?.githubService.usageCount ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProjectsExpanded((prev) => !prev)}
                aria-expanded={projectsExpanded}
                className="gap-1.5"
              >
                <Link2 className="h-4 w-4" />
                <span>Review {data.githubService.usageCount} project{data.githubService.usageCount === 1 ? "" : "s"}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${projectsExpanded ? "rotate-180" : ""}`} />
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href="/">
                  <Link2 className="h-4 w-4 mr-1.5" />
                  Browse projects
                </Link>
              </Button>
            )}
          </div>
        </div>

        {projectsExpanded && (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <span>Connected & Cloned Projects ({data?.githubService.projects?.length ?? data?.githubService.usageCount ?? 0})</span>
              <span className="text-[11px] font-normal normal-case text-zinc-400">Direct workspace access</span>
            </div>
            <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/80 rounded-lg border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40">
              {data?.githubService.projects && data.githubService.projects.length > 0 ? (
                data.githubService.projects.map((project) => {
                  const isCloned = project.importSource?.type === "github" || Boolean(project.importSource?.repoUrl);
                  const isSynced = Boolean(project.syncRepository || project.githubRepoUrl);
                  const repoName = project.syncRepository || project.githubRepoUrl || project.importSource?.repoUrl;

                  return (
                    <div
                      key={project.id}
                      className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 first:rounded-t-lg last:rounded-b-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-sm font-medium text-zinc-900 hover:text-primary dark:text-zinc-100 hover:underline truncate"
                          >
                            {project.title}
                          </Link>
                          {isCloned && (
                            <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              Cloned repository
                            </span>
                          )}
                          {isSynced && (
                            <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              GitHub sync
                            </span>
                          )}
                        </div>
                        {repoName ? (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                            <GitBranch className="h-3 w-3 shrink-0" />
                            <span className="truncate">{repoName}</span>
                            {project.syncBranch && (
                              <span className="text-zinc-400 dark:text-zinc-500 font-mono text-[11px]">
                                ({project.syncBranch})
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <Button variant="ghost" size="sm" asChild className="h-8 shrink-0 px-2.5 text-xs gap-1">
                        <Link href={`/projects/${project.slug}`}>
                          <span>Open</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-center text-xs text-zinc-500">
                  No connected or cloned projects found. Go to{" "}
                  <Link
                    href="/projects"
                    className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    projects
                  </Link>{" "}
                  to manage synchronization.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  </SettingsSectionCard>

    <SettingsSectionCard title="IDE & Editor Extensions" description="Manage authorized sessions and manual authentication tokens for all supported editors.">
      <div className="space-y-4">
        {sessionsLoading && !sessionData ? (
          <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        ) : sessionData?.sessions.length ? (
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            {activeSessions.length > 0 && (
              <>
                <div className="bg-zinc-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 border-b dark:bg-zinc-900/50">
                  Active Sessions ({activeSessions.length})
                </div>
                {activeSessions.map((session) => (
                  <ExtensionSessionRow
                    key={session.id}
                    session={session}
                    revoking={revoking === session.id}
                    onRevoke={() => void revoke(session.id)}
                  />
                ))}
              </>
            )}

            {pendingSessions.length > 0 && (
              <>
                <div className={`bg-zinc-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 border-b dark:bg-zinc-900/50 ${activeSessions.length > 0 ? "border-t" : ""}`}>
                  Pending Tokens ({pendingSessions.length})
                </div>
                {pendingSessions.map((session) => (
                  <ExtensionSessionRow
                    key={session.id}
                    session={session}
                    revoking={revoking === session.id}
                    onRevoke={() => void revoke(session.id)}
                  />
                ))}
              </>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-zinc-500">
            No active editor sessions.
          </p>
        )}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Manual authentication token</h4>
              <p className="mt-0.5 text-xs text-zinc-500">Use a fallback token if browser sign-in is blocked in your editor.</p>
            </div>
            <Button size="sm" variant={showTokenGen ? "ghost" : "outline"} onClick={() => setShowTokenGen(!showTokenGen)}>
              {showTokenGen ? "Cancel" : "Generate token"}
            </Button>
          </div>

          {showTokenGen && (
            <div className="mt-4 border-t pt-4 dark:border-zinc-800">
              {!generatedToken ? (
                <div className="space-y-3">
                  <div className="max-w-xs">
                    <input
                      type="text"
                      value={deviceLabel}
                      onChange={(e) => setDeviceLabel(e.target.value)}
                      placeholder="Device label (e.g. Workstation, optional)"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    />
                  </div>
                  <Button size="sm" onClick={() => void handleGenerateToken()} disabled={generatingToken}>
                    {generatingToken ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                    Generate new token
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      readOnly
                      value={generatedToken}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedToken);
                        toast.success("Copied to clipboard");
                      }}
                      className="shrink-0"
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setGeneratedToken(null);
                        setShowTokenGen(false);
                        setDeviceLabel("");
                      }}
                      className="shrink-0 text-xs"
                    >
                      Done
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50/80 p-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/40">
                    <KeyRound className="h-4 w-4 shrink-0" />
                    <span>This token is ready. Paste it into your editor&apos;s authentication prompt to complete connection.</span>
                  </div>
                </div>
              )}
              <p className="mt-2 text-[11px] text-zinc-500">This token will only be shown once. Paste it into your editor&apos;s authentication prompt.</p>
            </div>
          )}
        </div>
      </div>
    </SettingsSectionCard>

    <Dialog open={replacementConfirmOpen} onOpenChange={setReplacementConfirmOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replace the unavailable GitHub account?</DialogTitle>
          <DialogDescription>
            NetworkBase will detach {data?.githubService.githubUsername ? `@${data.githubService.githubUsername}` : "the unavailable account"} and then ask you to choose a new GitHub account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-xl border bg-zinc-50/70 p-4 text-sm text-zinc-600 dark:bg-zinc-950/40 dark:text-zinc-300">
          <p>Project files, repository links, sync history, and past contributor credit stay unchanged.</p>
          <p>Repository access is reviewed per project after the new account is linked.</p>
          <p>Only future commits switch to the new account&apos;s privacy-safe GitHub identity.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReplacementConfirmOpen(false)}>Cancel</Button>
          <Button onClick={() => void requestReplacementVerification()}>Verify and continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <SecurityStepUpDialog
      open={stepUpOpen}
      onOpenChange={setStepUpOpen}
      title="Verify this GitHub account change"
      description="Confirm your NetworkBase identity before the unavailable GitHub account is detached."
      availableMethods={replacementMethods}
      factorId={replacementFactorId}
      onVerified={replaceGithubAccount}
    />
  </div>;
}
