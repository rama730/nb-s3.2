"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Github,
  ArrowUpToLine,
  ArrowDownToLine,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Plus,
  FolderGit2,
  MoreHorizontal,
} from "lucide-react";
import * as sync from "@/app/actions/github-sync";
import {
  fetchGithubImportBranches,
  fetchGithubImportRepositories,
} from "@/lib/github/import-client";
import type { GithubImportAccessState } from "@/lib/github/import-types";
import { startGithubRepositoryAuthorization } from "@/lib/github/oauth-client";
import {
  GITHUB_SYNC_LIMITS,
  formatSyncMegabytes,
} from "@/lib/github/sync-limits";
import type {
  SyncManifest,
  SyncRunView,
  SyncResolution,
} from "@/lib/github/sync-contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const button =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 focus-visible:outline-blue-500";
const input =
  "min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;
type State = Success<Awaited<ReturnType<typeof sync.getGitHubSyncState>>>;
type Choice = { resolution?: SyncResolution; content?: string };
type CompareInput = Parameters<typeof sync.compareGitHubSync>[1];

export function GitHubSyncWorkspace({
  projectId,
  canManage,
  access,
  projectName,
}: {
  projectId: string;
  canManage: boolean;
  access: GithubImportAccessState | null;
  projectName?: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [newRepo, setNewRepo] = useState(false);
  const [setupMode, setSetupMode] = useState<"create" | "existing" | null>(
    null,
  );
  const [editingDestination, setEditingDestination] = useState(false);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [organization, setOrganization] = useState(false);
  const [direction, setDirection] = useState<"push" | "pull">("push");
  const [mode, setMode] = useState<"pr" | "direct">("pr");
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [message, setMessage] = useState("Update project files from Edge");
  const [review, setReview] = useState<SyncRunView | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [repos, setRepos] = useState<
    Array<{ fullName: string; htmlUrl: string; defaultBranch: string | null }>
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [diff, setDiff] = useState<{
    path: string;
    edge: string;
    github: string;
    base: string;
    binary: boolean;
  } | null>(null);
  const [merged, setMerged] = useState("");
  const appliedOperations = useRef(new Set<string>());
  const config: CompareInput = {
    direction,
    branch,
    mode,
    ...(newRepo
      ? { newRepository: { owner, name, private: isPrivate, organization } }
      : {}),
  };
  const active =
    state?.runs.some(
      (run) => run.status === "queued" || run.status === "running",
    ) ?? false;
  const load = useCallback(async () => {
    if (!canManage) return;
    const result = await sync.getGitHubSyncState(projectId);
    if (!result.success) throw new Error(result.error);
    setState(result.data);
    if (result.data.connection) {
      setNewRepo(false);
      setSetupMode(null);
      setEditingDestination(false);
      setRepository(result.data.connection.repository);
      setBranch(result.data.connection.branch);
    }
    for (const run of result.data.runs) {
      if (
        run.direction === "pull" &&
        run.result.applied?.length &&
        !appliedOperations.current.has(`${run.id}:${run.result.applied.length}`)
      ) {
        appliedOperations.current.add(`${run.id}:${run.result.applied.length}`);
        window.dispatchEvent(
          new CustomEvent("project:task-files-changed", {
            detail: { projectId },
          }),
        );
      }
    }
    return result.data;
  }, [projectId, canManage]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const authorizationError = url.searchParams.get("githubAuth");
    if (!authorizationError) return;
    setError(
      authorizationError === "account_mismatch"
        ? `GitHub authorized a different account. Choose ${access?.username || "the GitHub account linked to this workspace"} and try again.`
        : "GitHub did not return repository permission. Choose the linked GitHub account and try again.",
    );
    url.searchParams.delete("githubAuth");
    window.history.replaceState(window.history.state, "", url);
  }, [access?.username]);
  useEffect(() => {
    let cancelled = false;
    if (canManage)
      void sync.getGitHubSyncState(projectId).then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setError(result.error);
          return;
        }
        setState(result.data);
        setRepository(result.data.connection?.repository || "");
        setBranch(result.data.connection?.branch || "main");
        setOwner(result.data.account.username || "");
        setName(
          (projectName || "edge-project")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "edge-project",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, canManage, projectName]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void load().catch((error) => setError(error.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [active, load]);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function compare(nextDirection: "push" | "pull" = direction) {
    await perform(async () => {
      const comparisonConfig: CompareInput = {
        direction: nextDirection,
        branch,
        mode,
        ...(!state?.connection && newRepo
          ? { newRepository: { owner, name, private: isPrivate, organization } }
          : {}),
      };
      const result = await sync.compareGitHubSync(projectId, comparisonConfig);
      if (!result.success) throw new Error(result.error);
      setDirection(nextDirection);
      setManifest(result.data);
      setReview(null);
      setChoices({});
    });
  }
  async function prepare() {
    await perform(async () => {
      const selected = manifest!.files
        .filter((file) => choices[file.path])
        .map((file) => ({
          path: file.path,
          ...choices[file.path],
          expectedLocalHash: file.localHash,
          expectedRemoteSha: file.remoteSha,
        }));
      const result = await sync.prepareGitHubSync(
        projectId,
        config,
        selected,
        message,
      );
      if (!result.success) throw new Error(result.error);
      setReview(result.data);
    });
  }
  async function execute(run: SyncRunView) {
    await perform(async () => {
      const result = await sync.executeGitHubSync(projectId, run.id);
      if (!result.success) throw new Error(result.error);
      setReview(null);
      setManifest(null);
      await load();
    });
  }
  async function repositories(more = false) {
    await perform(async () => {
      const result = await fetchGithubImportRepositories({
        perPage: 50,
        ...(more && cursor ? { cursor } : {}),
      });
      setRepos((previous) =>
        more ? [...previous, ...result.items] : result.items,
      );
      setCursor(result.cursor);
    });
  }
  async function loadBranches(repoUrl: string) {
    if (!repoUrl) return;
    await perform(async () => {
      const result = await fetchGithubImportBranches({ repoUrl });
      setBranches(result.branches);
      if (!result.branches.includes(branch)) {
        setBranch(result.branches[0] || "main");
      }
    });
  }
  async function reviewSetup() {
    await perform(async () => {
      if (!newRepo) {
        const connected = await sync.connectGitHubSyncRepository(
          projectId,
          repository,
          branch,
        );
        if (!connected.success) throw new Error(connected.error);
      }
      const comparisonConfig: CompareInput = {
        direction: newRepo ? "push" : direction,
        branch,
        mode,
        ...(newRepo
          ? { newRepository: { owner, name, private: isPrivate, organization } }
          : {}),
      };
      const compared = await sync.compareGitHubSync(
        projectId,
        comparisonConfig,
      );
      if (!compared.success) throw new Error(compared.error);
      setDirection(comparisonConfig.direction);
      setManifest(compared.data);
      setReview(null);
      setChoices({});
      await load();
    });
  }
  const selectedCount = Object.keys(choices).length;
  const unresolved = manifest?.files.some(
    (file) =>
      choices[file.path] &&
      file.change === "conflict" &&
      !choices[file.path]?.resolution,
  );
  const latestRun = state?.runs[0] ?? null;
  return (
    <section
      aria-label="GitHub synchronization workspace"
      className="min-h-0 flex-1 overflow-y-auto p-4 text-zinc-900 dark:text-zinc-100 md:p-6"
    >
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Github aria-hidden="true" className="size-5" />
            GitHub Sync
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Review, publish, and bring changes back without losing file history
            or contributor credit.
          </p>
        </header>
        {error && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-red-500/40 p-3 text-sm"
          >
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}
        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Preparing reviewed changes…
          </p>
        )}
        {!canManage ? (
          <p className="text-sm text-zinc-500">
            Your file contributions are recorded automatically. Only the project
            owner can configure or execute synchronization.
          </p>
        ) : !state ? (
          error ? (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const current = await load();
                  if (current) {
                    setRepository(current.connection?.repository || "");
                    setBranch(current.connection?.branch || "main");
                  }
                })
              }
            >
              Retry connection
            </button>
          ) : (
            <p role="status">Loading GitHub connection…</p>
          )
        ) : !state.canAuthenticate ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
            <h3 className="font-semibold">Restore repository permission</h3>
            <p className="mt-1 text-sm text-zinc-500">
              GitHub is linked, but repository access is no longer available.
            </p>
            <button
              type="button"
              className={`${button} mt-4 bg-blue-600 text-white`}
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  startGithubRepositoryAuthorization({
                    login: access?.username || state.account.username,
                  }),
                )
              }
            >
              Restore GitHub access
            </button>
          </div>
        ) : (
          <>
            {!manifest && !state.connection && setupMode === null && (
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  className="group min-h-40 rounded-xl border border-zinc-200 p-5 text-left transition hover:border-blue-500 hover:bg-blue-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-800"
                  onClick={() => {
                    setSetupMode("create");
                    setNewRepo(true);
                    setDirection("push");
                  }}
                >
                  <Plus className="size-6 text-blue-500" aria-hidden="true" />
                  <span className="mt-4 block font-semibold">
                    Create a repository
                  </span>
                  <span className="mt-1 block text-sm text-zinc-500">
                    Review project files, then create a private GitHub
                    repository and publish.
                  </span>
                </button>
                <button
                  type="button"
                  className="group min-h-40 rounded-xl border border-zinc-200 p-5 text-left transition hover:border-blue-500 hover:bg-blue-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-800"
                  onClick={() => {
                    setSetupMode("existing");
                    setNewRepo(false);
                    void repositories();
                  }}
                >
                  <FolderGit2
                    className="size-6 text-blue-500"
                    aria-hidden="true"
                  />
                  <span className="mt-4 block font-semibold">
                    Connect an existing repository
                  </span>
                  <span className="mt-1 block text-sm text-zinc-500">
                    Choose an accessible repository and branch without
                    publishing anything yet.
                  </span>
                </button>
              </div>
            )}
            {!manifest && state.connection && !editingDestination && (
              <div className="space-y-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">
                      Connected
                    </p>
                    <a
                      className="mt-1 inline-flex items-center gap-2 font-semibold text-blue-500 hover:underline"
                      href={state.connection.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {state.connection.repository.replace(
                        /^https:\/\/github\.com\//,
                        "",
                      )}
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                    <p className="mt-1 text-sm text-zinc-500">
                      Branch: {state.connection.branch}
                    </p>
                  </div>
                  <details className="relative">
                    <summary
                      aria-label="Repository actions"
                      className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <MoreHorizontal className="size-5" aria-hidden="true" />
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 w-52 rounded-md border bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                      <a
                        className="block rounded px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        href={state.connection.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open on GitHub
                      </a>
                      <button
                        type="button"
                        className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => setEditingDestination(true)}
                      >
                        Change destination
                      </button>
                      <button
                        type="button"
                        className="block w-full rounded px-3 py-2 text-left text-red-500 hover:bg-red-500/10"
                        onClick={() => setDisconnectOpen(true)}
                      >
                        Disconnect repository…
                      </button>
                    </div>
                  </details>
                </div>
                {state.connection.incomingSha && (
                  <p className="rounded-md bg-amber-500/10 p-3 text-sm">
                    GitHub reported branch changes. Review a pull to inspect
                    them; nothing is imported automatically.
                  </p>
                )}
                {latestRun && (
                  <div className="rounded-md bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
                    <span className="font-medium">
                      Latest: {latestRun.direction === "push" ? "Push" : "Pull"}{" "}
                      · {latestRun.status}
                    </span>
                    <span className="ml-2 text-zinc-500">
                      {latestRun.stage}
                    </span>
                    {latestRun.error && (
                      <p className="mt-1 text-red-500">{latestRun.error}</p>
                    )}
                    {latestRun.result.pullRequestUrl && (
                      <a
                        className="mt-1 inline-flex items-center gap-1 text-blue-500"
                        href={latestRun.result.pullRequestUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open pull request <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${button} bg-blue-600 text-white`}
                    disabled={busy || active}
                    onClick={() => void compare("push")}
                  >
                    <ArrowUpToLine className="size-4" />
                    Review push
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy || active}
                    onClick={() => void compare("pull")}
                  >
                    <ArrowDownToLine className="size-4" />
                    Review pull
                  </button>
                </div>
              </div>
            )}
            {!manifest &&
              ((!state.connection && setupMode !== null) ||
                (state.connection && editingDestination)) && (
                <fieldset
                  disabled={busy || active}
                  className="space-y-4 rounded-lg border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800"
                >
                  <legend className="px-1 text-sm font-medium">
                    {state.connection
                      ? "Change repository destination"
                      : setupMode === "create"
                        ? "Create repository"
                        : "Connect repository"}
                  </legend>
                  {!state.connection && (
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={!newRepo}
                          onChange={() => setNewRepo(false)}
                        />
                        Existing repository
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={newRepo}
                          onChange={() => {
                            setNewRepo(true);
                            setDirection("push");
                          }}
                        />
                        Create a repository
                      </label>
                    </div>
                  )}
                  {newRepo ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm">
                          Owner
                          <input
                            className={input}
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                          />
                        </label>
                        <label className="text-sm">
                          Repository name
                          <input
                            className={input}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <label>
                          <input
                            type="checkbox"
                            checked={organization}
                            onChange={(e) => setOrganization(e.target.checked)}
                          />{" "}
                          Organization owner
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={(e) => setPrivate(e.target.checked)}
                          />{" "}
                          Private repository
                        </label>
                      </div>
                      <p className="text-xs text-zinc-500">
                        Nothing is created until you confirm the reviewed
                        publication. Organization creation requires GitHub
                        permission.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-0 flex-1 text-sm">
                          GitHub repository URL
                          <input
                            className={input}
                            value={repository}
                            onChange={(e) => setRepository(e.target.value)}
                            placeholder="https://github.com/owner/repository"
                          />
                        </label>
                        <button
                          type="button"
                          className={button}
                          onClick={() => void repositories()}
                        >
                          Browse repositories
                        </button>
                      </div>
                      {repos.length > 0 && (
                        <div className="flex gap-2">
                          <select
                            aria-label="Accessible GitHub repositories"
                            className={input}
                            value={repository}
                            onChange={(e) => {
                              setRepository(e.target.value);
                              const nextBranch =
                                repos.find(
                                  (repo) => repo.htmlUrl === e.target.value,
                                )?.defaultBranch || "main";
                              setBranch(nextBranch);
                              void loadBranches(e.target.value);
                            }}
                          >
                            <option value="">Choose repository…</option>
                            {repos.map((repo) => (
                              <option key={repo.htmlUrl} value={repo.htmlUrl}>
                                {repo.fullName}
                              </option>
                            ))}
                          </select>
                          {cursor && (
                            <button
                              type="button"
                              className={button}
                              onClick={() => void repositories(true)}
                            >
                              More
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="text-sm">
                      Branch
                      {branches.length ? (
                        <select
                          className={input}
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                        >
                          {branches.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={input}
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                        />
                      )}
                    </label>
                    <label className="text-sm">
                      Direction
                      <select
                        className={input}
                        value={direction}
                        onChange={(e) =>
                          setDirection(e.target.value as "push" | "pull")
                        }
                      >
                        <option value="push">Push to GitHub</option>
                        {!newRepo && (
                          <option value="pull">Pull into Edge</option>
                        )}
                      </select>
                    </label>
                    {direction === "push" && !newRepo && (
                      <label className="text-sm">
                        Publication
                        <select
                          className={input}
                          value={mode}
                          onChange={(e) =>
                            setMode(e.target.value as "pr" | "direct")
                          }
                        >
                          <option value="pr">
                            Open pull request (recommended)
                          </option>
                          <option value="direct">
                            Direct commit to branch
                          </option>
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${button} bg-blue-600 text-white`}
                      disabled={
                        !state.canAuthenticate ||
                        (newRepo ? !owner || !name : !repository || !branch)
                      }
                      onClick={() => void reviewSetup()}
                    >
                      {direction === "push" ? (
                        <ArrowUpToLine className="size-4" />
                      ) : (
                        <ArrowDownToLine className="size-4" />
                      )}
                      Review files
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        setEditingDestination(false);
                        if (!state.connection) setSetupMode(null);
                        setRepository(state.connection?.repository || "");
                        setBranch(state.connection?.branch || "main");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {state.connection?.incomingSha && (
                    <p role="status" className="text-sm">
                      GitHub has reported changes. Compare to inspect the latest
                      branch; no files are pulled automatically.
                    </p>
                  )}
                  <p className="text-xs text-zinc-500">
                    Only canonical project files are eligible. Task drafts,
                    Trash, generated files, potential secrets, LFS pointers, and
                    unsupported files are excluded before comparison. Review up
                    to {GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()}{" "}
                    paths per operation, with{" "}
                    {formatSyncMegabytes(GITHUB_SYNC_LIMITS.fileBytes)} MB per
                    file and{" "}
                    {formatSyncMegabytes(GITHUB_SYNC_LIMITS.operationBytes)} MB
                    per reviewed operation.
                  </p>
                </fieldset>
              )}
            {manifest && !review && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">
                    {direction === "push" ? "Outgoing" : "Incoming"} changes ·{" "}
                    {manifest.branch}
                  </h3>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      setManifest(null);
                      setChoices({});
                    }}
                  >
                    Back to destination
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      setChoices(
                        Object.fromEntries(
                          manifest.files
                            .filter(
                              (f) =>
                                !f.blocked &&
                                f.change !== "unchanged" &&
                                f.change !== "delete" &&
                                f.change !== "conflict",
                            )
                            .map((f) => [f.path, {}]),
                        ),
                      )
                    }
                  >
                    Select eligible additions and edits
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => setChoices({})}
                  >
                    Clear selection
                  </button>
                </div>
                <p className="text-xs text-zinc-500">
                  Deletions and conflicts require individual selection. Each
                  operation publishes only the reviewed snapshot.
                </p>
                <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {manifest.files.map((file) => (
                    <li
                      key={file.path}
                      className="flex flex-wrap items-center gap-3 p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${file.path}`}
                        disabled={
                          busy || !!file.blocked || file.change === "unchanged"
                        }
                        checked={!!choices[file.path]}
                        onChange={(e) =>
                          setChoices((old) => {
                            const next = { ...old };
                            if (e.target.checked) next[file.path] = {};
                            else delete next[file.path];
                            return next;
                          })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-medium">{file.path}</p>
                        <p className="text-xs text-zinc-500">
                          {file.blocked || file.change} ·{" "}
                          {(file.size / 1024).toFixed(1)} KB
                          {file.contributors.length
                            ? ` · ${file.contributors.map((author) => author.name).join(", ")}`
                            : ""}
                        </p>
                      </div>
                      {!file.blocked && file.change !== "unchanged" && (
                        <button
                          type="button"
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              const result = await sync.getGitHubSyncDiff(
                                projectId,
                                config,
                                file.path,
                              );
                              if (!result.success)
                                throw new Error(result.error);
                              setDiff({ path: file.path, ...result.data });
                              setMerged(
                                choices[file.path]?.content || result.data.edge,
                              );
                            })
                          }
                        >
                          Compare
                          {file.change === "conflict" ? " / resolve" : ""}
                        </button>
                      )}
                      {choices[file.path]?.resolution && (
                        <span className="text-xs">
                          Use {choices[file.path]?.resolution}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {!manifest.files.some(
                  (file) => !file.blocked && file.change !== "unchanged",
                ) && (
                  <p role="status">No eligible changes in this direction.</p>
                )}
                <label className="block text-sm">
                  {direction === "push" ? "Commit message" : "Import note"}
                  <textarea
                    className={input}
                    value={message}
                    maxLength={2000}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={`${button} bg-blue-600 text-white`}
                  disabled={
                    busy || !selectedCount || unresolved || !message.trim()
                  }
                  onClick={() => void prepare()}
                >
                  Review {selectedCount} selected files
                </button>
              </div>
            )}
            {review && (
              <div className="space-y-3 rounded-lg border border-blue-500/40 p-4">
                <h3 className="font-semibold">
                  Confirm{" "}
                  {review.direction === "push" ? "publication" : "import"}
                </h3>
                <p className="break-all text-sm">
                  {review.manifest.repository} · {review.manifest.branch} ·{" "}
                  {review.manifest.files.length} files
                </p>
                <p className="text-sm">
                  {review.direction === "pull"
                    ? "Incoming changes create file revisions. Reviewed deletions move files to Trash."
                    : review.manifest.newRepository
                      ? `Create a ${review.manifest.newRepository.private ? "private" : "PUBLIC"} repository and publish these files.`
                      : review.manifest.mode === "pr"
                        ? "Publish a separate branch and open a pull request. Nothing is auto-merged."
                        : "Write a commit directly to this branch. GitHub branch protections still apply."}
                </p>
                <ul className="max-h-52 overflow-auto text-sm">
                  {review.manifest.files.map((file) => (
                    <li key={file.path} className="break-all py-1">
                      {file.resultBlobSha ? "Write" : "Delete"} · {file.path}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-zinc-500">
                  Actual editors retain attribution. Edge automatically uses
                  each linked editor&apos;s privacy-safe GitHub identity when
                  available; unlinked editors remain credited inside Edge.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${button} bg-blue-600 text-white`}
                    disabled={busy || active}
                    onClick={() => void execute(review)}
                  >
                    {review.manifest.newRepository
                      ? "Create repository and publish"
                      : review.direction === "push"
                        ? "Confirm and publish"
                        : "Confirm and import"}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await sync.cancelGitHubSyncReview(
                          projectId,
                          review.id,
                        );
                        if (!result.success) throw new Error(result.error);
                        setReview(null);
                        setManifest(null);
                      })
                    }
                  >
                    Cancel review
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <Dialog
        open={!!diff}
        onOpenChange={(open) => {
          if (!open) setDiff(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-5xl overflow-y-auto">
          <DialogTitle>Compare file</DialogTitle>
          <DialogDescription className="break-all">
            {diff?.path}. Review both sides before choosing a conflict
            resolution.
          </DialogDescription>
          {diff?.binary ? (
            <p>
              This file requires a binary viewer. Choose the version to keep;
              text merging is unavailable.
            </p>
          ) : (
            <>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <div>
                  <h4>Edge</h4>
                  <pre className="max-h-64 overflow-auto rounded border p-3 text-xs">
                    {diff?.edge || "(File absent)"}
                  </pre>
                </div>
                <div>
                  <h4>GitHub</h4>
                  <pre className="max-h-64 overflow-auto rounded border p-3 text-xs">
                    {diff?.github || "(File absent)"}
                  </pre>
                </div>
              </div>
              <details>
                <summary>Common baseline</summary>
                <pre className="max-h-40 overflow-auto text-xs">
                  {diff?.base || "No recorded baseline"}
                </pre>
              </details>
            </>
          )}
          {diff &&
            manifest?.files.find((file) => file.path === diff.path)?.change ===
              "conflict" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(["edge", "github"] as const).map((resolution) => (
                    <button
                      key={resolution}
                      type="button"
                      className={button}
                      onClick={() => {
                        if (
                          resolution ===
                          (direction === "push" ? "github" : "edge")
                        ) {
                          setChoices((old) => {
                            const next = { ...old };
                            delete next[diff.path];
                            return next;
                          });
                          setDiff(null);
                          return;
                        }
                        setChoices((old) => ({
                          ...old,
                          [diff.path]: { resolution },
                        }));
                        setDiff(null);
                      }}
                    >
                      {resolution === (direction === "push" ? "github" : "edge")
                        ? "Keep destination · skip this file"
                        : `Use ${resolution === "edge" ? "Edge" : "GitHub"} version`}
                    </button>
                  ))}
                </div>
                {!diff.binary && (
                  <>
                    <label>
                      Resolved text
                      <textarea
                        className={`${input} min-h-40 font-mono`}
                        value={merged}
                        onChange={(e) => setMerged(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        setChoices((old) => ({
                          ...old,
                          [diff.path]: { resolution: "merge", content: merged },
                        }));
                        setDiff(null);
                      }}
                    >
                      Use resolved text
                    </button>
                  </>
                )}
              </>
            )}
        </DialogContent>
      </Dialog>
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogTitle>Disconnect this repository?</DialogTitle>
          <DialogDescription>
            Project files, GitHub files, and recorded contribution history are
            kept. Unexecuted reviews are cancelled. GitHub repository access is
            not revoked.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => setDisconnectOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || active}
              onClick={() =>
                void perform(async () => {
                  const result =
                    await sync.disconnectGitHubSyncRepository(projectId);
                  if (!result.success) throw new Error(result.error);
                  setDisconnectOpen(false);
                  setManifest(null);
                  setReview(null);
                  setRepository("");
                  await load();
                })
              }
            >
              Disconnect
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
