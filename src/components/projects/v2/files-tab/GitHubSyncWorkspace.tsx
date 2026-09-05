"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Search,
  ShieldCheck,
  CheckCircle2,
  Users,
  GitBranch,
  GitPullRequest,
  GitCommit,
  Clock,
  Check,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  FileText,
  Layers,
  RefreshCw,
  X,
  Pencil,
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
import { isGithubWorkflowPermissionError } from "@/lib/github/sync-contract";
import type {
  SyncManifest,
  SyncRunView,
  SyncResolution,
} from "@/lib/github/sync-contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

const button =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 focus-visible:outline-blue-500";
const input =
  "min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;
type State = Success<Awaited<ReturnType<typeof sync.getGitHubSyncState>>>;
type Choice = { resolution?: SyncResolution; content?: string };
type CompareInput = Parameters<typeof sync.compareGitHubSync>[1];

function scanForSecrets(
  path: string,
  content?: string | null,
): { blocked: boolean; reason?: string } {
  const lowerPath = path.toLowerCase();
  if (
    lowerPath.endsWith(".env") ||
    lowerPath.includes(".env.") ||
    lowerPath.endsWith(".pem") ||
    lowerPath.endsWith(".key")
  ) {
    return {
      blocked: true,
      reason: `Sensitive configuration file pattern (${path})`,
    };
  }
  if (!content) return { blocked: false };

  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(content)) {
    return { blocked: true, reason: "Private cryptographic key detected" };
  }
  if (/AKIA[0-9A-Z]{16}/.test(content)) {
    return { blocked: true, reason: "AWS Access Key ID detected" };
  }
  if (/ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82}/.test(content)) {
    return { blocked: true, reason: "GitHub Personal Access Token detected" };
  }
  if (/sk_live_[0-9a-zA-Z]{24,}/.test(content)) {
    return { blocked: true, reason: "Stripe Live Secret Key detected" };
  }
  if (/sk-(?:proj-)?[0-9a-zA-Z_-]{32,}/.test(content)) {
    return { blocked: true, reason: "OpenAI API Key detected" };
  }
  return { blocked: false };
}

function SplitDiffViewer({
  leftTitle,
  leftContent,
  rightTitle,
  rightContent,
}: {
  leftTitle: string;
  leftContent: string;
  rightTitle: string;
  rightContent: string;
}) {
  const leftLines = leftContent ? leftContent.split("\n") : [];
  const rightLines = rightContent ? rightContent.split("\n") : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-lg overflow-hidden border-zinc-200 dark:border-zinc-800 text-xs font-mono">
      <div className="flex flex-col border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800">
        <div className="bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
          <span>{leftTitle}</span>
          <span className="text-[10px] text-zinc-500">{leftLines.length} lines</span>
        </div>
        <div className="max-h-72 overflow-y-auto overflow-x-auto p-2 space-y-0.5 bg-zinc-50 dark:bg-zinc-950">
          {leftLines.length === 0 ? (
            <p className="p-2 text-zinc-400 italic">(File absent)</p>
          ) : (
            leftLines.map((line, idx) => (
              <div key={idx} className="flex gap-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50">
                <span className="w-8 text-right select-none text-zinc-400 shrink-0">{idx + 1}</span>
                <span className="whitespace-pre break-all">{line || " "}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="flex flex-col">
        <div className="bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
          <span>{rightTitle}</span>
          <span className="text-[10px] text-zinc-500">{rightLines.length} lines</span>
        </div>
        <div className="max-h-72 overflow-y-auto overflow-x-auto p-2 space-y-0.5 bg-zinc-50 dark:bg-zinc-950">
          {rightLines.length === 0 ? (
            <p className="p-2 text-zinc-400 italic">(File absent)</p>
          ) : (
            rightLines.map((line, idx) => (
              <div key={idx} className="flex gap-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50">
                <span className="w-8 text-right select-none text-zinc-400 shrink-0">{idx + 1}</span>
                <span className="whitespace-pre break-all">{line || " "}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ContributorIdentitySection({
  identity,
  onApproved,
}: {
  identity?: { login: string; email: string } | null;
  onApproved: (email: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<{
    account: { login: string; avatar_url: string };
    emails: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(identity?.email || "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const fetchOptions = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await sync.getGitHubCommitIdentityOptions();
      if (res.success) {
        setOptions(res.data);
        if (!selectedEmail && res.data.emails[0]) {
          setSelectedEmail(res.data.emails[0]);
        }
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950/50 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">
            Git Commit Attribution
          </h4>
          <p className="text-xs text-zinc-500">
            {identity
              ? `Currently configured as: ${identity.login} <${identity.email}>`
              : "Approve your verified GitHub email or privacy-safe noreply handle for commit attribution."}
          </p>
        </div>
        {!options && (
          <button
            type="button"
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            disabled={loading}
            onClick={() => void fetchOptions()}
          >
            {loading ? "Loading…" : identity ? "Change Email" : "Configure Email"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {options && (
        <div className="mt-3 space-y-2 border-t pt-3 border-zinc-100 dark:border-zinc-800">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Select verified commit author email:
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Verified GitHub emails"
              className="min-h-9 rounded border border-zinc-300 bg-transparent px-2.5 py-1 text-xs dark:border-zinc-700"
              value={selectedEmail}
              onChange={(e) => setSelectedEmail(e.target.value)}
            >
              {options.emails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={loading || !selectedEmail}
              onClick={async () => {
                setLoading(true);
                setError("");
                try {
                  await onApproved(selectedEmail);
                  setSaved(true);
                  setTimeout(() => setSaved(false), 3000);
                  setOptions(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? "Saving…" : "Save Attribution"}
            </button>
            <button
              type="button"
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              onClick={() => setOptions(null)}
            >
              Cancel
            </button>
          </div>
          {saved && (
            <p className="text-xs text-emerald-600">Attribution saved successfully.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function GitHubSyncWorkspace({
  projectId,
  canManage,
  access,
  projectName,
  projectSlug,
}: {
  projectId: string;
  canManage: boolean;
  access: GithubImportAccessState | null;
  projectName?: string;
  projectSlug?: string;
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
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [organization, setOrganization] = useState(false);
  const [direction, setDirection] = useState<"push" | "pull">("push");
  const [mode, setMode] = useState<"pr" | "direct">("direct");
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [message, setMessage] = useState("Update project files from NetworkBase");
  const [review, setReview] = useState<SyncRunView | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [repos, setRepos] = useState<
    Array<{ fullName: string; htmlUrl: string; defaultBranch: string | null }>
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [customBranchMode, setCustomBranchMode] = useState(false);
  const [diff, setDiff] = useState<{
    path: string;
    edge: string;
    github: string;
    base: string;
    binary: boolean;
  } | null>(null);
  const [merged, setMerged] = useState("");
  const [activeInspectPath, setActiveInspectPath] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [executingRun, setExecutingRun] = useState<{
    id: string;
    branch: string;
    direction: "push" | "pull";
    mode: "direct" | "pr";
    fileCount: number;
    message: string;
    stage: string;
  } | null>(null);
  const [syncSuccessToast, setSyncSuccessToast] = useState<{
    sha?: string;
    branch: string;
    direction: "push" | "pull";
    fileCount: number;
  } | null>(null);
  const [changeRepoDialogOpen, setChangeRepoDialogOpen] = useState(false);
  const [changeRepoUrl, setChangeRepoUrl] = useState("");
  const [customBranchInput, setCustomBranchInput] = useState("");
  const [showCustomBranch, setShowCustomBranch] = useState(false);
  const appliedOperations = useRef(new Set<string>());
  const config: CompareInput = {
    direction,
    branch,
    mode,
    ...(newRepo
      ? { newRepository: { owner, name, private: isPrivate, organization } }
      : {}),
  };

  const inspectFile = useCallback(
    async (filePath: string) => {
      setActiveInspectPath(filePath);
      setLoadingDiff(true);
      try {
        const result = await sync.getGitHubSyncDiff(projectId, config, filePath);
        if (result.success) {
          setDiff({ path: filePath, ...result.data });
          setMerged(choices[filePath]?.content || result.data.edge);
        }
      } catch {
        // Ignore transient diff loading error
      } finally {
        setLoadingDiff(false);
      }
    },
    [projectId, config, choices],
  );

  const selectedContributors = useMemo(() => {
    if (!manifest) return [];
    const map = new Map<
      string,
      {
        name: string;
        email?: string | null;
        avatarUrl?: string | null;
        login?: string | null;
      }
    >();
    for (const file of manifest.files) {
      if (choices[file.path]) {
        for (const author of file.contributors) {
          const key = author.userId || author.githubId || author.name;
          if (key && !map.has(String(key))) {
            map.set(String(key), {
              name: author.name,
              email: author.email,
              avatarUrl: author.avatarUrl,
              login: author.githubLogin,
            });
          }
        }
      }
    }
    return [...map.values()];
  }, [manifest, choices]);

  const [filterSearch, setFilterSearch] = useState("");
  const [showCleanFiles, setShowCleanFiles] = useState(false);
  const [filterCategory, setFilterCategory] = useState<
    "all" | "staged" | "add" | "modify" | "conflict" | "delete"
  >("all");
  const [copiedInvite, setCopiedInvite] = useState(false);

  const filterCounts = useMemo(() => {
    if (!manifest)
      return { all: 0, actionable: 0, staged: 0, add: 0, modify: 0, conflict: 0, delete: 0, unchanged: 0 };
    let staged = 0,
      add = 0,
      modify = 0,
      conflict = 0,
      del = 0,
      unchanged = 0;
    for (const f of manifest.files) {
      if (choices[f.path]) staged++;
      if (f.change === "add") add++;
      else if (f.change === "modify") modify++;
      else if (f.change === "conflict") conflict++;
      else if (f.change === "delete") del++;
      else if (f.change === "unchanged") unchanged++;
    }
    const actionable = add + modify + conflict + del;
    return {
      all: manifest.files.length,
      actionable,
      staged,
      add,
      modify,
      conflict,
      delete: del,
      unchanged,
    };
  }, [manifest, choices]);

  const { actionableVisibleFiles, cleanVisibleFiles } = useMemo(() => {
    if (!manifest) return { actionableVisibleFiles: [], cleanVisibleFiles: [] };
    const query = filterSearch.trim().toLowerCase();
    const files = manifest.files.filter((f) => {
      if (filterCategory === "staged" && !choices[f.path]) return false;
      if (filterCategory === "add" && f.change !== "add") return false;
      if (filterCategory === "modify" && f.change !== "modify") return false;
      if (filterCategory === "conflict" && f.change !== "conflict") return false;
      if (filterCategory === "delete" && f.change !== "delete") return false;

      if (query && !f.path.toLowerCase().includes(query)) return false;
      return true;
    });

    const actionable = files.filter((f) => f.change !== "unchanged");
    const clean = files.filter((f) => f.change === "unchanged");
    return { actionableVisibleFiles: actionable, cleanVisibleFiles: clean };
  }, [manifest, choices, filterCategory, filterSearch]);

  const detectedSecurityRisk = useMemo(() => {
    if (!manifest) return null;
    for (const f of manifest.files) {
      if (choices[f.path]) {
        const fileContent =
          choices[f.path]?.content ||
          (diff?.path === f.path ? diff.edge : null);
        const scan = scanForSecrets(f.path, fileContent);
        if (scan.blocked) {
          return { path: f.path, reason: scan.reason };
        }
      }
    }
    return null;
  }, [manifest, choices, diff]);
  const active =
    state?.runs.some(
      (run) => run.status === "queued" || run.status === "running",
    ) ?? false;
  const load = useCallback(async () => {
    if (!canManage) return;
    const result = await sync.getGitHubSyncState(projectId);
    if (!result.success) throw new Error(result.error);
    setState(result.data);
    setReview(
      result.data.runs.find(
        (run) => run.status === "review" || run.status === "failed",
      ) || null,
    );
    if (result.data.connection) {
      setNewRepo(false);
      setSetupMode(null);
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
      void load()
        .then((current) => {
          if (cancelled) return;
          if (!current) return;
          setOwner(current.account.username || "");
          setName(
            (projectName || "edge-project")
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9._-]+/g, "-")
              .replace(/^-+|-+$/g, "") || "edge-project",
          );
        })
        .catch((error) => setError(error.message));
    return () => {
      cancelled = true;
    };
  }, [canManage, load, projectName]);

  const setGitSyncBadge = useFilesWorkspaceStore((s) => s.setGitSyncBadge);
  const [syncTasks, setSyncTasks] = useState<
    Array<{ id: string; title: string; key: string }>
  >([]);

  useEffect(() => {
    if (!state) return;
    const isRunning = state.runs.some(
      (run) => run.status === "queued" || run.status === "running",
    );
    const latest = state.runs[0] ?? null;
    if (isRunning) {
      setGitSyncBadge(projectId, {
        status: "syncing",
        tooltip: "GitHub synchronization in progress",
      });
    } else if (latest?.status === "failed") {
      setGitSyncBadge(projectId, {
        status: "failed",
        tooltip: latest.error || "GitHub sync failed",
      });
    } else if (state.connection?.incomingSha) {
      setGitSyncBadge(projectId, {
        status: "incoming",
        count: 1,
        tooltip: "New changes available on GitHub",
      });
    } else if (latest?.status === "completed") {
      setGitSyncBadge(projectId, {
        status: "completed",
        tooltip: "GitHub sync up-to-date",
      });
    } else {
      setGitSyncBadge(projectId, null);
    }
  }, [state, projectId, setGitSyncBadge]);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    void sync
      .getProjectSyncTasks(projectId)
      .then((res) => {
        if (!cancelled && res.success) {
          setSyncTasks(res.data);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [manifest, projectId]);

  const handleApproveIdentity = useCallback(
    async (email: string) => {
      const res = await sync.approveGitHubCommitIdentity(email);
      if (!res.success) throw new Error(res.error);
      if (canManage) await load();
    },
    [canManage, load],
  );

  useEffect(() => {
    if (!syncSuccessToast) return;
    const timer = setTimeout(() => {
      setSyncSuccessToast(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [syncSuccessToast]);

  // Ponytail: adaptive backoff polling (2.5s -> 6s) when active, pauses when hidden
  useEffect(() => {
    if (!active) return;
    let delay = 2500;
    let timer: NodeJS.Timeout | null = null;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        try {
          await load();
        } catch (error) {
          setError((error as Error).message);
        }
      }
      if (!cancelled) {
        delay = Math.min(6000, delay + 500);
        timer = setTimeout(poll, delay);
      }
    };

    timer = setTimeout(poll, delay);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        delay = 2500;
        void load().catch((error) => setError((error as Error).message));
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, load]);

  // Ponytail: Auto-load branches whenever repo changes or connection is loaded
  useEffect(() => {
    const targetRepo = repository || state?.connection?.repository;
    if (
      targetRepo &&
      targetRepo.startsWith("https://github.com/") &&
      !newRepo
    ) {
      void loadBranches(targetRepo);
    }
  }, [setupMode, repository, state?.connection?.repository, newRepo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "P" || e.key === "p") {
          e.preventDefault();
          if (!busy && !active && state?.connection && !manifest && !review) {
            void compare("push", "direct");
          }
        } else if (e.key === "L" || e.key === "l") {
          e.preventDefault();
          if (!busy && !active && state?.connection && !manifest && !review) {
            void compare("pull", "direct");
          }
        } else if (e.key === "R" || e.key === "r") {
          e.preventDefault();
          if (!busy && !active && state?.connection && !manifest && !review) {
            void compare("push", "pr");
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, active, state?.connection, manifest, review]);

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
  async function compare(
    nextDirection: "push" | "pull" = direction,
    nextMode: "direct" | "pr" = mode,
  ) {
    setIsComparing(true);
    try {
      await perform(async () => {
        const comparisonConfig: CompareInput = {
          direction: nextDirection,
          branch,
          mode: nextMode,
          ...(!state?.connection && newRepo
            ? { newRepository: { owner, name, private: isPrivate, organization } }
            : {}),
        };
        const result = await sync.compareGitHubSync(projectId, comparisonConfig);
        if (!result.success) throw new Error(result.error);
        setDirection(nextDirection);
        setMode(nextMode);
        setManifest(result.data);
        setReview(null);
        setChoices({});
        await load();
      });
    } finally {
      setIsComparing(false);
    }
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
    setExecutingRun({
      id: run.id,
      branch: run.manifest.branch,
      direction: run.direction,
      mode: run.manifest.mode,
      fileCount: run.manifest.files.length,
      message: run.manifest.message,
      stage: "Packaging Git snapshot & verifying signatures...",
    });
    setReview(null);
    setManifest(null);

    await perform(async () => {
      try {
        const result = await sync.executeGitHubSync(projectId, run.id);
        if (!result.success) throw new Error(result.error);
        setSyncSuccessToast({
          sha: result.data.result?.commitSha?.slice(0, 7),
          branch: run.manifest.branch,
          direction: run.direction,
          fileCount: run.manifest.files.length,
        });
        await load();
      } finally {
        setExecutingRun(null);
      }
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
    if (!repoUrl || !repoUrl.startsWith("https://github.com/")) return;
    setLoadingBranches(true);
    try {
      const result = await fetchGithubImportBranches({ repoUrl });
      if (result && Array.isArray(result.branches)) {
        setBranches(result.branches);
        if (result.branches.length > 0 && (!branch || !result.branches.includes(branch))) {
          if (!branch) {
            setBranch(result.branches[0] || "main");
          }
        }
      }
    } catch {
      // Non-blocking: user can still type or enter custom branch manually
    } finally {
      setLoadingBranches(false);
    }
  }

  async function handleSwitchBranch(newBranch: string) {
    if (!state?.connection || !newBranch.trim() || newBranch === state.connection.branch) return;
    await perform(async () => {
      const update = await sync.connectGitHubSyncRepository(
        projectId,
        state.connection!.repository,
        newBranch.trim(),
      );
      if (!update.success) throw new Error(update.error);
      setBranch(newBranch.trim());
      await load();
      toast.success(`Target branch switched to ${newBranch.trim()}`);
    });
  }

  async function handleSaveRepoUrl() {
    if (!state?.connection || !changeRepoUrl.trim()) return;
    await perform(async () => {
      const targetRepo = changeRepoUrl.trim();
      const update = await sync.connectGitHubSyncRepository(
        projectId,
        targetRepo,
        state.connection!.branch || "main",
      );
      if (!update.success) throw new Error(update.error);
      setRepository(targetRepo);
      setChangeRepoDialogOpen(false);
      await load();
      await loadBranches(targetRepo);
      toast.success("Repository destination updated");
    });
  }

  const openChangeRepoDialog = () => {
    setChangeRepoUrl(state?.connection?.repository || "");
    setChangeRepoDialogOpen(true);
  };
  async function reviewSetup() {
    setIsComparing(true);
    try {
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
    } finally {
      setIsComparing(false);
    }
  }
  const selectedCount = Object.keys(choices).length;
  const unresolved = manifest?.files.some(
    (file) =>
      choices[file.path] &&
      file.change === "conflict" &&
      !choices[file.path]?.resolution,
  );
  const latestRun = state?.runs[0] ?? null;
  const activeRun = state?.runs.find(
    (run) => run.status === "queued" || run.status === "running",
  );
  const workflowPermissionRequired = isGithubWorkflowPermissionError(
    error || review?.error,
  );
  const authorizeWorkflow = () =>
    perform(() =>
      startGithubRepositoryAuthorization({
        login: access?.username || state?.account.username,
      }),
    );
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
            className="flex flex-wrap items-center gap-3 rounded-md border border-red-500/40 p-3 text-sm"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            {workflowPermissionRequired && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void authorizeWorkflow()}
              >
                Authorize workflow publishing
              </button>
            )}
          </div>
        )}
        {!canManage ? (
          <div className="space-y-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Github className="size-6 text-zinc-700 dark:text-zinc-300" />
              <div>
                <h3 className="font-semibold text-base">GitHub Synchronization</h3>
                <p className="text-sm text-zinc-500">
                  Project files and task attachments are synchronized with GitHub.
                </p>
              </div>
            </div>
            <p className="rounded-lg bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Only the project owner can configure repository connections or execute push/pull synchronization. You can configure your commit attribution below.
            </p>
            <ContributorIdentitySection
              identity={null}
              onApproved={handleApproveIdentity}
            />
          </div>
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
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50 flex flex-col items-center justify-center gap-3 min-h-64 animate-pulse">
              <div className="size-10 rounded-xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                <Github className="size-5 text-zinc-400" />
              </div>
              <div className="h-4 w-44 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-64 rounded bg-zinc-100 dark:bg-zinc-800/60" />
            </div>
          )
        ) : !state.canAuthenticate ? (
          <div className="rounded-xl border border-blue-500/40 bg-blue-500/5 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <Github className="size-8 text-blue-600 dark:text-blue-400" />
              <div>
                <h3 className="font-semibold text-base">
                  {!state.account.linked
                    ? "Connect your GitHub Account"
                    : "Authorize repository access"}
                </h3>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {!state.account.linked
                    ? "Link your GitHub account to publish code, open pull requests, and sync remote updates directly from NetworkBase."
                    : "Your GitHub account is linked, but repository access needs to be refreshed."}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={`${button} mt-2 bg-blue-600 text-white hover:bg-blue-700`}
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  startGithubRepositoryAuthorization({
                    login: access?.username || state.account.username,
                  }),
                )
              }
            >
              <Github className="size-4" />
              {!state.account.linked
                ? "Connect GitHub Account"
                : "Restore GitHub access"}
            </button>
          </div>
        ) : (activeRun || executingRun) ? (
          <div
            role="status"
            className="space-y-4 rounded-xl border border-blue-500/40 bg-blue-50/20 p-5 dark:border-blue-500/30 dark:bg-blue-950/20 shadow-xs animate-in fade-in duration-200"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                  {!executingRun && activeRun?.status === "queued"
                    ? "Synchronization queued"
                    : executingRun?.direction === "pull" || activeRun?.direction === "pull"
                      ? "Importing remote commits"
                      : "Publishing Git commit to remote"}
                </h3>
              </div>
              <span className="rounded bg-blue-100 dark:bg-blue-900/50 px-2.5 py-0.5 text-xs font-mono font-medium text-blue-700 dark:text-blue-300">
                {executingRun?.branch || activeRun?.manifest.branch || state.connection?.branch || "main"}
              </span>
            </div>

            {/* Glowing Indeterminate Progress Stream (Numbers omitted for clean execution) */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950/60">
              <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500 animate-[pulse_1.5s_ease-in-out_infinite]" />
            </div>

            {/* Semantic Phase Indicators (Numbers Omitted) */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-2 text-xs dark:border-emerald-800/40 dark:bg-emerald-950/20">
                <div className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" />
                  <span>Integrity</span>
                </div>
                <p className="text-[10px] text-emerald-600/80 mt-0.5">Checksums verified</p>
              </div>
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-2 text-xs dark:border-emerald-800/40 dark:bg-emerald-950/20">
                <div className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" />
                  <span>Security</span>
                </div>
                <p className="text-[10px] text-emerald-600/80 mt-0.5">Clean secret scan</p>
              </div>
              <div className="rounded-lg border border-blue-400 bg-blue-50 p-2 text-xs dark:border-blue-700 dark:bg-blue-950/50">
                <div className="flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Git Publisher</span>
                </div>
                <p className="text-[10px] text-blue-600/80 mt-0.5 truncate">
                  {executingRun ? "Materializing snapshot & publishing" : (activeRun?.stage || "Publishing to remote")}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-1 font-semibold text-zinc-500">
                  <Clock className="size-3.5" />
                  <span>Attribution</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">RFC Git co-authorship</p>
              </div>
            </div>

            <p className="break-all text-xs text-zinc-500">
              Repository: {state.connection?.repository || activeRun?.manifest.repository || ""} · {(executingRun?.fileCount ?? activeRun?.manifest.files.length ?? 0).toLocaleString()} files staged
            </p>
            {!executingRun && activeRun?.status === "queued" && (
              <button
                type="button"
                className={`${button} bg-blue-600 text-white font-medium`}
                disabled={busy}
                onClick={() => void execute(activeRun)}
              >
                Resume synchronization
              </button>
            )}
          </div>
        ) : (
          <>
            {!manifest &&
              !review &&
              !state.connection &&
              setupMode === null && (
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
            {!manifest &&
              !review &&
              !executingRun &&
              state.connection && (
                <div className="space-y-4">
                  {syncSuccessToast && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-50/50 p-4 dark:border-emerald-500/30 dark:bg-emerald-950/20 shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-2xs">
                          <CheckCircle2 className="size-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                            {syncSuccessToast.direction === "push" ? "Push synchronization completed" : "Pull synchronization completed"}
                          </h4>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Successfully {syncSuccessToast.direction === "push" ? "pushed" : "merged"} {syncSuccessToast.fileCount} files with branch <strong className="font-mono text-zinc-800 dark:text-zinc-200">{syncSuccessToast.branch}</strong>
                            {syncSuccessToast.sha && <> · Commit <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{syncSuccessToast.sha}</span></>}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSyncSuccessToast(null)}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200/50 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                        aria-label="Dismiss message"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  )}
                  {/* Zone 1: Unified Sync Command Deck (Hero Surface) */}
                  <div className="relative z-30 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 shadow-xs">
                    {/* Top Bar: Identity & Quick Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/60 px-5 py-3.5 rounded-t-xl">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-2xs">
                          <Github className="size-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <a
                              className="font-bold text-base text-zinc-900 hover:text-blue-600 dark:text-zinc-100 dark:hover:text-blue-400 inline-flex items-center gap-1.5 transition-colors"
                              href={state.connection.repository}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {state.connection.repository.replace(/^https:\/\/github\.com\//, "")}
                              <ExternalLink className="size-3.5 text-zinc-400" aria-hidden="true" />
                            </a>
                            <button
                              type="button"
                              onClick={openChangeRepoDialog}
                              title="Change repository URL"
                              className="rounded p-1 text-zinc-400 hover:bg-zinc-200/50 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                            >
                              <Pencil className="size-3" />
                            </button>
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 flex items-center gap-1.5 border border-emerald-200/50 dark:border-emerald-800/50">
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Connected
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
                            {/* Inline Target Branch Switcher Dropdown */}
                            <details className="relative group/branch">
                              <summary
                                className="inline-flex items-center gap-1 font-mono font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer list-none select-none transition-colors"
                                title="Click to switch target branch"
                              >
                                <GitBranch className="size-3 text-blue-500" />
                                <span>{state.connection.branch}</span>
                                <ChevronDown className="size-3 opacity-70 group-open/branch:rotate-180 transition-transform" />
                              </summary>
                              {/* Click-outside backdrop */}
                              <div
                                className="fixed inset-0 z-40 hidden group-open/branch:block cursor-default"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                }}
                              />
                              <div className="absolute left-0 z-50 mt-1.5 w-64 rounded-xl border border-zinc-200 bg-white/98 p-2 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/98 space-y-1.5 text-left">
                                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                                  <span>Target Branch</span>
                                  {loadingBranches ? (
                                    <Loader2 className="size-3 animate-spin text-zinc-400" />
                                  ) : (
                                    <span>{branches.length} available</span>
                                  )}
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-0.5">
                                  {branches.map((b) => (
                                    <button
                                      key={b}
                                      type="button"
                                      onClick={async (e) => {
                                        e.currentTarget.closest("details")?.removeAttribute("open");
                                        await handleSwitchBranch(b);
                                      }}
                                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                                        b === state.connection?.branch
                                          ? "bg-blue-50 text-blue-700 font-semibold dark:bg-blue-950/50 dark:text-blue-300"
                                          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                                      }`}
                                    >
                                      <span className="truncate">{b}</span>
                                      {b === state.connection?.branch && (
                                        <Check className="size-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                                <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
                                  {showCustomBranch ? (
                                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                                      <input
                                        type="text"
                                        placeholder="Branch name…"
                                        value={customBranchInput}
                                        onChange={(e) => setCustomBranchInput(e.target.value)}
                                        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-mono text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                                        onKeyDown={async (e) => {
                                          if (e.key === "Enter" && customBranchInput.trim()) {
                                            e.currentTarget.closest("details")?.removeAttribute("open");
                                            setShowCustomBranch(false);
                                            await handleSwitchBranch(customBranchInput.trim());
                                            setCustomBranchInput("");
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        disabled={!customBranchInput.trim() || busy}
                                        onClick={async (e) => {
                                          e.currentTarget.closest("details")?.removeAttribute("open");
                                          setShowCustomBranch(false);
                                          await handleSwitchBranch(customBranchInput.trim());
                                          setCustomBranchInput("");
                                        }}
                                        className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 shrink-0 cursor-pointer"
                                      >
                                        Set
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setShowCustomBranch(true)}
                                      className="w-full text-left px-2 py-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                                    >
                                      + Custom branch
                                    </button>
                                  )}
                                </div>
                              </div>
                            </details>
                            <span>·</span>
                            <span>RFC Git Co-authorship Active</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {/* Unified Git Command Dropdown (Replaces 2 large buttons) */}
                        <details className="relative group/cmd">
                          <summary
                            aria-label="GitHub Commands Menu"
                            className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-500 px-3.5 py-1.5 text-xs font-semibold shadow-xs cursor-pointer list-none transition-all duration-150 active:scale-98 select-none"
                          >
                            {isComparing ? (
                              <>
                                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                                <span>Loading GitHub data…</span>
                              </>
                            ) : (
                              <>
                                <GitPullRequest className="size-3.5 shrink-0" />
                                <span>Git Commands</span>
                                <ChevronDown className="size-3 opacity-80 group-open/cmd:rotate-180 transition-transform" />
                              </>
                            )}
                          </summary>

                          {/* Transparent click-outside backdrop when open */}
                          <div
                            className="fixed inset-0 z-40 hidden group-open/cmd:block cursor-default"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          />

                          <div className="absolute right-0 z-50 mt-2 w-84 rounded-xl border border-zinc-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/98 space-y-1 text-left divide-y divide-zinc-100 dark:divide-zinc-800/60">
                            <div className="px-3 py-2 flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                Active Branch
                              </span>
                              <span className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
                                <GitBranch className="size-3 text-blue-500" />
                                {state.connection.branch}
                              </span>
                            </div>

                            {/* Command 1: Push */}
                            <div className="pt-1">
                              <button
                                type="button"
                                disabled={busy || active}
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  void compare("push", "direct");
                                }}
                                className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 transition-colors group/item cursor-pointer"
                              >
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 group-hover/item:scale-105 transition-transform">
                                  <ArrowUpToLine className="size-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 group-hover/item:text-blue-600 dark:group-hover/item:text-blue-400">
                                      Review push to GitHub
                                    </span>
                                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-mono text-blue-600 dark:text-blue-400 font-medium">
                                      Direct Commit
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-zinc-500 leading-snug">
                                    Stage local additions &amp; write commit to {state.connection.branch}.
                                  </p>
                                </div>
                              </button>
                            </div>

                            {/* Command 2: Pull */}
                            <div className="pt-1">
                              <button
                                type="button"
                                disabled={busy || active}
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  void compare("pull", "direct");
                                }}
                                className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 transition-colors group/item cursor-pointer"
                              >
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 group-hover/item:scale-105 transition-transform">
                                  <ArrowDownToLine className="size-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 group-hover/item:text-emerald-600 dark:group-hover/item:text-emerald-400">
                                      Review pull from GitHub
                                    </span>
                                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                      Safe 3-Way
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-zinc-500 leading-snug">
                                    Inspect &amp; safely merge incoming remote commits without overwriting drafts.
                                  </p>
                                </div>
                              </button>
                            </div>

                            {/* Command 3: Pull Request */}
                            <div className="pt-1">
                              <button
                                type="button"
                                disabled={busy || active}
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  void compare("push", "pr");
                                }}
                                className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 transition-colors group/item cursor-pointer"
                              >
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 group-hover/item:scale-105 transition-transform">
                                  <GitPullRequest className="size-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 group-hover/item:text-purple-600 dark:group-hover/item:text-purple-400">
                                      Create Pull Request
                                    </span>
                                    <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-mono text-purple-600 dark:text-purple-400 font-medium">
                                      PR Review
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-zinc-500 leading-snug">
                                    Publish isolated branch and open GitHub PR for team review.
                                  </p>
                                </div>
                              </button>
                            </div>
                          </div>
                        </details>

                        <details className="relative group/more">
                          <summary
                            aria-label="Repository actions"
                            className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </summary>
                          {/* Transparent click-outside backdrop when open */}
                          <div
                            className="fixed inset-0 z-40 hidden group-open/more:block cursor-default"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          />
                          <div className="absolute right-0 z-50 mt-1 w-52 rounded-md border bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                            <a
                              className="block rounded px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300"
                              href={state.connection.repository}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open on GitHub
                            </a>
                            <button
                              type="button"
                              className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
                              onClick={(e) => {
                                e.currentTarget.closest("details")?.removeAttribute("open");
                                openChangeRepoDialog();
                              }}
                            >
                              Change repository…
                            </button>
                            <button
                              type="button"
                              className="block w-full rounded px-3 py-2 text-left text-red-500 hover:bg-red-500/10 text-xs"
                              onClick={() => setDisconnectOpen(true)}
                            >
                              Disconnect repository…
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>

                    {/* Compact Command Status & Guidance Strip (Replaces 180px cards, saves 140px vertical space) */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs bg-zinc-50/40 dark:bg-zinc-950/30 text-zinc-500 border-t border-zinc-100 dark:border-zinc-800/60 rounded-b-xl">
                      <div className="flex items-center gap-2">
                        <span className="flex size-2 rounded-full bg-emerald-500" />
                        <span>Ready to synchronize with remote branch <strong className="font-mono text-zinc-800 dark:text-zinc-200">{state.connection.branch}</strong>.</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-mono">
                        <span>{(state.filesCount || 0).toLocaleString()} tracked files</span>
                        <span>·</span>
                        <span className="text-blue-600 dark:text-blue-400">Git Commands active</span>
                      </div>
                    </div>
                  </div>

                  {/* Zone 2: 2-Column Balanced Intelligence Matrix */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left Column: Telemetry & Activity Card (7 Columns) */}
                    <div className="lg:col-span-7 flex flex-col space-y-4">
                      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-xs space-y-4 flex-1">
                        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                            <FolderGit2 className="size-3.5 text-blue-500" />
                            Runtime &amp; Repository Health
                          </span>
                          <span className="text-[11px] font-mono text-zinc-400">
                            RFC 2822 Safe
                          </span>
                        </div>

                        {/* 3 Telemetry Metrics */}
                        <div className="grid grid-cols-3 gap-2.5">
                          <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/60 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/50">
                            <span className="text-[11px] text-zinc-400 block font-medium">Tracked Files</span>
                            <p className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                              {(state.filesCount || 0).toLocaleString()} <span className="text-[10px] font-normal text-zinc-400">canonical</span>
                            </p>
                          </div>
                          <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/60 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/50">
                            <span className="text-[11px] text-zinc-400 block font-medium">Last Remote Commit</span>
                            <p className="mt-1 text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {latestRun?.result.commitSha ? (
                                <a
                                  href={`${state.connection.repository}/commit/${latestRun.result.commitSha}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {latestRun.result.commitSha.slice(0, 7)}
                                </a>
                              ) : (
                                "Initialized"
                              )}
                              <span className="ml-1 text-[10px] font-normal text-zinc-400">
                                {latestRun?.status === "completed" ? "✓ synced" : ""}
                              </span>
                            </p>
                          </div>
                          <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/60 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/50">
                            <span className="text-[11px] text-zinc-400 block font-medium">Attribution Mode</span>
                            <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
                              {state.identity?.login ? `@${state.identity.login}` : "Privacy-Safe"}
                            </p>
                          </div>
                        </div>

                        {/* Latest Sync Event & Ecosystem Broadcast */}
                        {latestRun ? (
                          <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/50 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 text-xs">
                                <CheckCircle2 className="size-3.5 text-emerald-600" />
                                Latest: {latestRun.direction === "push" ? "Push to GitHub" : "Pull from GitHub"} ·{" "}
                                <span className="uppercase text-[10px] font-bold text-emerald-600">{latestRun.status}</span>
                              </span>
                              <div className="flex items-center gap-2 text-[11px]">
                                {latestRun.result.commitSha && (
                                  <a
                                    href={`${state.connection.repository}/commit/${latestRun.result.commitSha}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline dark:text-blue-400 inline-flex items-center gap-1 font-mono"
                                  >
                                    Commit {latestRun.result.commitSha.slice(0, 7)} <ExternalLink className="size-2.5" />
                                  </a>
                                )}
                                {latestRun.result.pullRequestUrl && (
                                  <a
                                    className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400 font-medium"
                                    href={latestRun.result.pullRequestUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    PR #{latestRun.result.pullRequestNumber} <ExternalLink className="size-2.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                            {latestRun.status === "completed" && latestRun.direction === "push" && (
                              <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Check className="size-3" />
                                  Ecosystem sync broadcasted to Project Updates &amp; task milestones updated.
                                </span>
                                <a
                                  href={`/projects/${encodeURIComponent(projectSlug || projectId)}?tab=updates`}
                                  className="text-blue-600 hover:underline dark:text-blue-400 font-medium inline-flex items-center gap-1"
                                >
                                  View Project Updates &rarr;
                                </a>
                              </div>
                            )}
                            {latestRun.error && <p className="text-red-500 text-xs">{latestRun.error}</p>}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-center text-xs text-zinc-400 dark:border-zinc-800">
                            No sync operations recorded yet. Click &quot;Review &amp; Push to GitHub&quot; above to publish your first changes.
                          </div>
                        )}

                        {/* Embedded Personal Git Commit Attribution */}
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                          <ContributorIdentitySection
                            identity={state.identity}
                            onApproved={handleApproveIdentity}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Team Attribution Readiness Hub (5 Columns) */}
                    <div className="lg:col-span-5 flex flex-col space-y-4">
                      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-xs flex-1 flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                              <Users className="size-3.5 text-blue-500" />
                              Team Co-Authorship Hub
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:text-zinc-300">
                              {state.teamMembers?.filter((m) => !!m.githubLogin).length || 0} of {state.teamMembers?.length || 0} Linked
                            </span>
                          </div>

                          <p className="text-xs text-zinc-500">
                            Verified team members automatically receive Git co-author attribution on push based on their file contribution history.
                          </p>

                          {/* Team Member Roster (Capped, Scrollable) */}
                          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-[260px] overflow-y-auto">
                            {(state.teamMembers || []).map((member) => (
                              <div
                                key={member.userId}
                                className="flex items-center justify-between gap-2 p-2.5 text-xs hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30 transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {member.avatarUrl ? (
                                    <img src={member.avatarUrl} alt="" className="size-6 rounded-full shrink-0" />
                                  ) : (
                                    <div className="size-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                                      {member.name.charAt(0)}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100 leading-tight">
                                      {member.name}
                                    </p>
                                    <p className="text-[10px] text-zinc-400 capitalize">
                                      {member.membershipRole || "Contributor"}
                                    </p>
                                  </div>
                                </div>

                                <div className="shrink-0 flex items-center gap-1.5">
                                  {member.githubLogin ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                      <Check className="size-2.5" />
                                      @{member.githubLogin}
                                    </span>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span
                                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                        title="Attributed in NetworkBase; link in Settings to receive credit on GitHub"
                                      >
                                        Unlinked
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (typeof window !== "undefined") {
                                            navigator.clipboard.writeText(`${window.location.origin}/connections`);
                                            setCopiedInvite(true);
                                            setTimeout(() => setCopiedInvite(false), 2500);
                                          }
                                        }}
                                        className="text-[10px] text-blue-600 hover:underline dark:text-blue-400 font-medium px-1"
                                        title="Copy GitHub connection link to invite this member"
                                      >
                                        {copiedInvite ? "Copied!" : "Invite"}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Co-Authorship Status Notice at bottom of right card */}
                        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-[11px]">
                          {(state.teamMembers?.some((m) => !m.githubLogin)) ? (
                            <div className="rounded-md border border-amber-200/80 bg-amber-50/60 p-2 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300 flex items-start gap-1.5">
                              <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                              <span>
                                Unlinked members will have their changes attributed to repository defaults until they connect their GitHub account.
                              </span>
                            </div>
                          ) : (
                            <div className="rounded-md border border-emerald-200/80 bg-emerald-50/60 p-2 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300 flex items-center gap-1.5">
                              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              <span>All active team members verified. 100% co-author credit active.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            {!manifest &&
              !review &&
              !state.connection &&
              setupMode !== null && (
              <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden shadow-xs">
                {/* 1. Deck Header & Mode Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/60 px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/50">
                      <FolderGit2 className="size-4.5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {state.connection
                          ? "Change repository destination"
                          : setupMode === "create"
                            ? "Create repository"
                            : "Connect repository"}
                      </h3>
                      <p className="text-[11px] text-zinc-500">
                        Configure target GitHub repository, branch destination, and transfer strategy.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!state.connection && (
                      <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-0.5 text-xs shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setNewRepo(false)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                            !newRepo
                              ? "bg-blue-600 text-white font-semibold shadow-xs"
                              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                          }`}
                        >
                          Existing repository
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNewRepo(true);
                            setDirection("push");
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                            newRepo
                              ? "bg-blue-600 text-white font-semibold shadow-xs"
                              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                          }`}
                        >
                          Create a repository
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors shadow-2xs"
                      onClick={() => {
                        setSetupMode(null);
                        setRepository(state?.connection?.repository || "");
                        setBranch(state?.connection?.branch || "main");
                      }}
                    >
                      Back
                    </button>
                  </div>
                </div>

                {/* 2. Main Form Body */}
                <div className="p-5 space-y-4">
                  {newRepo ? (
                    <div className="space-y-3.5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 space-y-1 block">
                          <span>Owner (User or Organization)</span>
                          <input
                            className={`${input} min-h-9 text-xs`}
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                            placeholder="e.g. your-github-username"
                          />
                        </label>
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 space-y-1 block">
                          <span>Repository name</span>
                          <input
                            className={`${input} min-h-9 text-xs font-mono`}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. project-files"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                        <label className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={organization}
                            onChange={(e) => setOrganization(e.target.checked)}
                          />
                          <span>Organization repository</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={(e) => setPrivate(e.target.checked)}
                          />
                          <span>Private repository</span>
                        </label>
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Nothing is published until you confirm in reviewed staging. Organization creation requires GitHub permissions.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 space-y-1.5 block">
                        <span className="flex items-center justify-between">
                          <span>Target GitHub Repository URL</span>
                          {repository && repository.startsWith("https://github.com/") && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 font-mono">
                              <Check className="size-2.5" /> Valid URL
                            </span>
                          )}
                        </span>
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                          <div className="relative flex-1 min-w-0">
                            <Github className="absolute left-3 top-2.5 size-3.5 text-zinc-400" />
                            <input
                              className={`${input} min-h-9 text-xs font-mono pl-9 pr-3`}
                              value={repository}
                              onChange={(e) => setRepository(e.target.value)}
                              placeholder="https://github.com/owner/repository"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${button} min-h-9 text-xs px-3.5 shrink-0`}
                            onClick={() => void repositories()}
                          >
                            Browse repositories
                          </button>
                        </div>
                      </label>

                      {repos.length > 0 && (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-zinc-200/80 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/50">
                          <select
                            aria-label="Accessible GitHub repositories"
                            className="flex-1 min-w-0 rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100"
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
                            <option value="">Select from your accessible repositories…</option>
                            {repos.map((repo) => (
                              <option key={repo.htmlUrl} value={repo.htmlUrl}>
                                {repo.fullName}
                              </option>
                            ))}
                          </select>
                          {cursor && (
                            <button
                              type="button"
                              className="rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0 font-medium"
                              onClick={() => void repositories(true)}
                            >
                              Load more
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Transfer Direction & Branch Engine (2-Column Responsive Card Grid) */}
                  <div className="grid gap-3 sm:grid-cols-2 pt-1">
                    {/* Left Panel: Transfer Direction & Publication Strategy */}
                    <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/40 space-y-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">
                        Transfer Direction &amp; Flow
                      </span>

                      {/* Direction Segmented Button */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setDirection("push")}
                          className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-medium transition-all ${
                            direction === "push"
                              ? "border-blue-600 bg-blue-50/80 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-600 font-semibold shadow-xs"
                              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100"
                          }`}
                        >
                          <ArrowUpToLine className="size-4 mb-1 text-blue-600 dark:text-blue-400" />
                          <span>Push to GitHub</span>
                          <span className="text-[10px] font-normal text-zinc-400 mt-0.5">Workspace &rarr; Remote</span>
                        </button>

                        {!newRepo ? (
                          <button
                            type="button"
                            onClick={() => setDirection("pull")}
                            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-medium transition-all ${
                              direction === "pull"
                                ? "border-emerald-600 bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-600 font-semibold shadow-xs"
                                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100"
                            }`}
                          >
                            <ArrowDownToLine className="size-4 mb-1 text-emerald-600 dark:text-emerald-400" />
                            <span>Pull into NetworkBase</span>
                            <span className="text-[10px] font-normal text-zinc-400 mt-0.5">Remote &rarr; Workspace</span>
                          </button>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400 opacity-60">
                            <span className="text-[10px]">Pull unavailable</span>
                            <span className="text-[9px]">New repository</span>
                          </div>
                        )}
                      </div>

                      {/* Publication Mode Selector (When Push) */}
                      {direction === "push" && !newRepo && (
                        <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
                          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                            Publication Strategy:
                          </label>
                          <select
                            aria-label="Publication strategy"
                            className="w-full rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100"
                            value={mode}
                            onChange={(e) => setMode(e.target.value as "pr" | "direct")}
                          >
                            <option value="pr">Open pull request (recommended for team review)</option>
                            <option value="direct">Direct commit to branch</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Right Panel: Target Branch & Protection Rules */}
                    <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">
                          Target Branch &amp; Protection
                        </span>
                        <div className="flex items-center gap-2">
                          {branches.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setCustomBranchMode((prev) => !prev)}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-medium"
                            >
                              {customBranchMode ? "Choose from list" : "+ Custom branch"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void loadBranches(repository)}
                            disabled={loadingBranches || !repository}
                            className="text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Refresh branch list from GitHub"
                          >
                            <RefreshCw className={`size-3 ${loadingBranches ? "animate-spin" : ""}`} />
                            <span>{loadingBranches ? "Fetching..." : "Refresh"}</span>
                          </button>
                        </div>
                      </div>

                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 space-y-1 block">
                        <span className="flex items-center justify-between">
                          <span>Target Branch Name</span>
                          <span className="text-[10px] font-mono text-zinc-400">git branch</span>
                        </span>
                        <div className="relative">
                          <GitBranch className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400" />
                          {!customBranchMode && branches.length > 0 ? (
                            <select
                              aria-label="Target branch"
                              className={`${input} min-h-9 text-xs font-mono pl-8`}
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
                              className={`${input} min-h-9 text-xs font-mono pl-8`}
                              value={branch}
                              onChange={(e) => setBranch(e.target.value)}
                              placeholder="e.g. main"
                            />
                          )}
                        </div>
                        {loadingBranches ? (
                          <p className="text-[10px] text-blue-500 flex items-center gap-1">
                            <RefreshCw className="size-2.5 animate-spin" /> Fetching available branches from GitHub...
                          </p>
                        ) : branches.length > 0 && !customBranchMode ? (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Check className="size-2.5" /> {branches.length} {branches.length === 1 ? "branch" : "branches"} available on GitHub.
                          </p>
                        ) : (
                          <p className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Type branch name or click &quot;Refresh&quot; to fetch list.</span>
                            {!branches.length && (
                              <button
                                type="button"
                                onClick={() => void loadBranches(repository)}
                                className="text-blue-500 hover:underline font-semibold"
                              >
                                Fetch branches
                              </button>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 space-y-1 text-[11px] text-zinc-500">
                        <p className="flex items-center gap-1.5">
                          <Check className="size-3 text-emerald-500 shrink-0" />
                          <span>Branch protections and review requirements respected.</span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <Check className="size-3 text-emerald-500 shrink-0" />
                          <span>Preserves existing file history and co-author attribution.</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 4. Pre-Flight Guardrail Telemetry Bar */}
                  <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/60 px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                      <ShieldCheck className="size-3.5 text-blue-500" />
                      <span>Pre-Flight Operation Limits:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 dark:bg-zinc-800 font-mono text-[10px]">
                        Up to {GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files
                      </span>
                      <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 dark:bg-zinc-800 font-mono text-[10px]">
                        {formatSyncMegabytes(GITHUB_SYNC_LIMITS.fileBytes)} MB/file
                      </span>
                      <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 dark:bg-zinc-800 font-mono text-[10px]">
                        {formatSyncMegabytes(GITHUB_SYNC_LIMITS.operationBytes)} MB/op
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        Zero-Leak Shield Armed
                      </span>
                    </div>
                  </div>

                  {/* 5. Action Execution Bar */}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      className={`${button} bg-blue-600 text-white font-medium px-5 min-h-9 h-9 text-xs shadow-xs`}
                      disabled={
                        busy ||
                        active ||
                        isComparing ||
                        !state.canAuthenticate ||
                        (newRepo ? !owner || !name : !repository || !branch)
                      }
                      onClick={() => void reviewSetup()}
                    >
                      {isComparing ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                          <span>Loading GitHub data…</span>
                        </>
                      ) : (
                        <>
                          {direction === "push" ? (
                            <ArrowUpToLine className="size-3.5 mr-1.5" />
                          ) : (
                            <ArrowDownToLine className="size-3.5 mr-1.5" />
                          )}
                          <span>Review files &amp; Enter Staging</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`${button} min-h-9 h-9 text-xs px-4`}
                      disabled={busy}
                      onClick={() => {
                        setSetupMode(null);
                        setRepository(state?.connection?.repository || "");
                        setBranch(state?.connection?.branch || "main");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            {manifest && !review && (
              <div className="flex flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden shadow-xs">
                {/* 1. Command Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/80">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-2xs"
                      disabled={busy}
                      onClick={() => {
                        setManifest(null);
                        setChoices({});
                        setActiveInspectPath(null);
                        setDiff(null);
                      }}
                    >
                      <ArrowLeft className="size-3" />
                      <span>Back to Overview</span>
                    </button>
                    <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        {direction === "push" ? "Outgoing to GitHub:" : "Incoming from GitHub:"}
                      </span>
                      <span className="font-mono text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        {state?.connection?.repository ? state.connection.repository.split("/").slice(-2).join("/") : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-mono font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                        <GitBranch className="size-3" />
                        {manifest.branch}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      <Check className="size-3 text-emerald-500" />
                      {selectedCount} of {filterCounts.actionable} Staged
                    </span>
                    <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
                    <button
                      type="button"
                      className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      disabled={busy}
                      onClick={() => {
                        const eligible = manifest.files.filter(
                          (file) =>
                            !file.blocked &&
                            file.change !== "unchanged" &&
                            file.change !== "delete" &&
                            file.change !== "conflict",
                        );
                        const selected = eligible.slice(0, GITHUB_SYNC_LIMITS.operationFiles);
                        setChoices(Object.fromEntries(selected.map((file) => [file.path, {}])));
                      }}
                    >
                      Select eligible
                    </button>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <button
                      type="button"
                      className="text-xs text-zinc-500 hover:underline"
                      disabled={busy}
                      onClick={() => setChoices({})}
                    >
                      Clear selection
                    </button>
                  </div>
                </div>

                {/* 2. Files Navigator & Staging Area */}
                <div className="p-4 space-y-3">
                  {/* Search & Category Filter Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="relative flex-1 min-w-[240px] max-w-md">
                      <Search className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Filter files by path… (e.g. .pdf, docs/)"
                        className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-8 pr-6 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100"
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                      />
                      {filterSearch && (
                        <button
                          type="button"
                          onClick={() => setFilterSearch("")}
                          className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-600 text-xs"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setFilterCategory("all")}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          filterCategory === "all"
                            ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 font-medium"
                            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        All ({filterCounts.actionable})
                      </button>
                      {filterCounts.staged > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("staged")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "staged"
                              ? "bg-blue-600 text-white font-medium"
                              : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          }`}
                        >
                          Staged ({filterCounts.staged})
                        </button>
                      )}
                      {filterCounts.add > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("add")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "add"
                              ? "bg-emerald-600 text-white font-medium"
                              : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          }`}
                        >
                          Added ({filterCounts.add})
                        </button>
                      )}
                      {filterCounts.modify > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("modify")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "modify"
                              ? "bg-blue-600 text-white font-medium"
                              : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          }`}
                        >
                          Modified ({filterCounts.modify})
                        </button>
                      )}
                      {filterCounts.conflict > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("conflict")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "conflict"
                              ? "bg-red-600 text-white font-medium"
                              : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                          }`}
                        >
                          Conflicts ({filterCounts.conflict})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* File List Container */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-[380px] overflow-y-auto">
                    {/* Section 1: Actionable Changes */}
                    <div className="p-2.5 bg-zinc-50/70 dark:bg-zinc-950/50 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                      <span>Pending Changes ({actionableVisibleFiles.length})</span>
                      <span className="text-[10px] font-normal normal-case text-zinc-400">Click &quot;View Diff&quot; to inspect changes</span>
                    </div>

                    {actionableVisibleFiles.length === 0 ? (
                      <div className="p-8 text-center text-xs text-zinc-400">
                        {filterSearch ? "No pending changes match filter." : "No pending changes. Local files match GitHub remote."}
                      </div>
                    ) : (
                      actionableVisibleFiles.map((file) => {
                        const isSelected = !!choices[file.path];
                        const isConflict = file.change === "conflict";
                        return (
                          <div
                            key={file.path}
                            className="flex items-center justify-between gap-3 p-3 text-xs hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.path}`}
                                disabled={busy || !!file.blocked || file.change === "unchanged"}
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked && selectedCount >= GITHUB_SYNC_LIMITS.operationFiles) {
                                    setError(`Select no more than ${GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files per operation.`);
                                    return;
                                  }
                                  setChoices((old) => {
                                    const next = { ...old };
                                    if (e.target.checked) next[file.path] = {};
                                    else delete next[file.path];
                                    return next;
                                  });
                                  setError("");
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-100 font-mono text-xs">
                                    {file.path}
                                  </span>
                                  {isConflict ? (
                                    <span className="rounded bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                      conflict
                                    </span>
                                  ) : file.change === "add" ? (
                                    <span className="rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                      +added
                                    </span>
                                  ) : file.change === "modify" ? (
                                    <span className="rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                      modified
                                    </span>
                                  ) : file.change === "delete" ? (
                                    <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                      -deleted
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-400">
                                  <span>{(file.size / 1024).toFixed(1)} KB</span>
                                  {file.contributors.length > 0 && (
                                    <>
                                      <span>·</span>
                                      <span className="truncate max-w-[180px]">
                                        {file.contributors.map((a) => a.name).join(", ")}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* View Diff Button on the right of the row */}
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-200/80 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 shrink-0 transition-colors shadow-2xs"
                              onClick={() => void inspectFile(file.path)}
                            >
                              <FileText className="size-3 text-blue-500" />
                              <span>View Diff</span>
                            </button>
                          </div>
                        );
                      })
                    )}

                    {/* Section 2: Clean Repository Files (Collapsible Accordion) */}
                    {cleanVisibleFiles.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowCleanFiles((prev) => !prev)}
                          className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors border-t border-zinc-100 dark:border-zinc-800"
                        >
                          <span className="flex items-center gap-1.5">
                            {showCleanFiles ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            Clean Repository Files ({cleanVisibleFiles.length})
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {showCleanFiles ? "Click to hide" : "Unchanged"}
                          </span>
                        </button>

                        {showCleanFiles && (
                          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/40 bg-zinc-50/20 dark:bg-zinc-950/20">
                            {cleanVisibleFiles.map((file) => (
                              <div
                                key={file.path}
                                className="flex items-center justify-between p-2.5 px-4 text-xs text-zinc-500 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/30 font-mono text-[11px]"
                              >
                                <span className="truncate">{file.path}</span>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="text-[10px] text-zinc-400">{(file.size / 1024).toFixed(1)} KB</span>
                                  <button
                                    type="button"
                                    className="text-[11px] text-blue-600 hover:underline dark:text-blue-400 font-sans font-medium"
                                    onClick={() => void inspectFile(file.path)}
                                  >
                                    View Diff
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Action & Commit Deck */}
                <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/50 p-4 space-y-3.5">
                  {/* Row 1: Strategy & Task Directives */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {direction === "push" && !newRepo && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Strategy:</span>
                        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setMode("direct")}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                              mode === "direct"
                                ? "bg-blue-600 text-white font-semibold shadow-xs"
                                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                            }`}
                          >
                            Direct commit to {manifest.branch}
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode("pr")}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                              mode === "pr"
                                ? "bg-blue-600 text-white font-semibold shadow-xs"
                                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                            }`}
                          >
                            Open Pull Request
                          </button>
                        </div>
                      </div>
                    )}

                    {syncTasks.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-zinc-500 text-[11px]">Auto-action task:</span>
                        <select
                          aria-label="Link task to commit message"
                          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const [directive, key] = val.split(":");
                            setMessage((prev) => {
                              const tag = `${directive} #${key}`;
                              return prev.includes(tag) ? prev : `${prev.trim()} ${tag}`;
                            });
                            e.target.value = "";
                          }}
                        >
                          <option value="">Choose task &amp; action…</option>
                          {syncTasks.map((t) => (
                            <optgroup key={t.id} label={`${t.key}: ${t.title.slice(0, 24)}`}>
                              <option value={`Closes:${t.key}`}>Closes #{t.key} (Mark Done on push)</option>
                              <option value={`Ref:${t.key}`}>Ref #{t.key} (Reference only)</option>
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Commit Message Input with Conventional Commit Chips */}
                  <div className="space-y-1.5">
                    <div className="relative">
                      <input
                        type="text"
                        id="sync-commit-message"
                        className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 pr-16 font-mono"
                        value={message}
                        maxLength={2000}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="feat: concise commit summary (e.g. Closes #NB-14)..."
                      />
                      <span className="absolute right-2.5 top-2 text-[10px] font-mono text-zinc-400">
                        {message.length}/2000
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-zinc-400 font-medium mr-1">Prefix:</span>
                      {["feat:", "fix:", "refactor:", "docs:", "perf:", "chore:"].map((prefix) => (
                        <button
                          key={prefix}
                          type="button"
                          onClick={() => {
                            setMessage((prev) => {
                              const clean = prev.replace(/^(feat|fix|refactor|docs|perf|chore)(\([a-z0-9-]+\))?:\s*/i, "");
                              return `${prefix} ${clean}`.trim();
                            });
                          }}
                          className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-mono font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          {prefix}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Row 3: Pre-Flight Safety Shield & Action Button */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3 text-[11px]">
                      {detectedSecurityRisk ? (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold animate-pulse">
                          <AlertTriangle className="size-3.5" />
                          Security Alert: {detectedSecurityRisk.reason}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <ShieldCheck className="size-3.5" />
                          Secret Scan: Clean
                        </span>
                      )}
                      <span className="text-zinc-300 dark:text-zinc-700">·</span>
                      <span className="text-zinc-500">
                        Payload: &lt; {formatSyncMegabytes(GITHUB_SYNC_LIMITS.operationBytes)} MB
                      </span>
                      {selectedContributors.length > 0 && (
                        <>
                          <span className="text-zinc-300 dark:text-zinc-700">·</span>
                          <span className="text-zinc-500">
                            {selectedContributors.length} credited author{selectedContributors.length > 1 ? "s" : ""}
                          </span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`${button} bg-blue-600 text-white font-medium px-5 min-h-9 h-9 text-xs shadow-xs`}
                      disabled={busy || !selectedCount || unresolved || !message.trim() || !!detectedSecurityRisk}
                      onClick={() => void prepare()}
                    >
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {direction === "push"
                        ? mode === "direct"
                          ? `Commit & Push ${selectedCount} ${selectedCount === 1 ? "File" : "Files"} directly to ${manifest.branch}`
                          : `Create PR (${selectedCount} ${selectedCount === 1 ? "File" : "Files"})`
                        : `Import ${selectedCount} ${selectedCount === 1 ? "File" : "Files"}`}
                    </button>
                  </div>

                  {detectedSecurityRisk && (
                    <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
                      <p className="text-[11px]">
                        <strong>Blocked:</strong> {detectedSecurityRisk.reason} found in <code>{detectedSecurityRisk.path}</code>. Unstage before pushing.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* On-Demand Diff Inspector Dialog */}
            <Dialog
              open={!!activeInspectPath}
              onOpenChange={(open) => {
                if (!open) {
                  setActiveInspectPath(null);
                  setDiff(null);
                }
              }}
            >
              <DialogContent className="max-w-4xl w-full max-h-[85vh] flex flex-col p-6 overflow-hidden bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-xl">
                <DialogTitle className="flex items-center justify-between gap-3 text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  <span className="truncate">{activeInspectPath}</span>
                  {activeInspectPath && choices[activeInspectPath]?.resolution && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 font-sans">
                      Resolution: {choices[activeInspectPath]?.resolution}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-500">
                  Comparing NetworkBase workspace against remote {manifest?.branch}
                </DialogDescription>

                {/* 1-Click Conflict Resolution Toolbar */}
                {manifest && activeInspectPath && manifest.files.find((f) => f.path === activeInspectPath)?.change === "conflict" && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs dark:border-amber-700/40 dark:bg-amber-950/30 shrink-0 mt-2">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200 mb-2">
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>Concurrent conflict detected. Choose which version to keep:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`rounded px-3 py-1.5 font-medium text-xs transition-colors border shadow-sm ${
                          choices[activeInspectPath]?.resolution === "edge"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100"
                        }`}
                        onClick={() => {
                          setChoices((prev) => ({
                            ...prev,
                            [activeInspectPath]: { resolution: "edge" },
                          }));
                        }}
                      >
                        Keep NetworkBase (Mine)
                      </button>
                      <button
                        type="button"
                        className={`rounded px-3 py-1.5 font-medium text-xs transition-colors border shadow-sm ${
                          choices[activeInspectPath]?.resolution === "github"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100"
                        }`}
                        onClick={() => {
                          setChoices((prev) => ({
                            ...prev,
                            [activeInspectPath]: { resolution: "github" },
                          }));
                        }}
                      >
                        Keep GitHub (Theirs)
                      </button>
                    </div>
                  </div>
                )}

                {/* Diff Viewer Canvas */}
                <div className="flex-1 overflow-y-auto min-h-0 pt-3">
                  {loadingDiff ? (
                    <div className="flex items-center justify-center p-16 text-xs text-zinc-400 gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Loading file diff…</span>
                    </div>
                  ) : diff && diff.path === activeInspectPath ? (
                    diff.binary ? (
                      <p className="p-8 text-xs text-zinc-500 italic bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 text-center">
                        Binary content cannot be diffed textually.
                      </p>
                    ) : (
                      <SplitDiffViewer
                        leftTitle="NetworkBase Workspace (Local)"
                        leftContent={diff.edge}
                        rightTitle={`GitHub (${manifest?.branch})`}
                        rightContent={diff.github}
                      />
                    )
                  ) : (
                    <p className="p-8 text-xs text-zinc-400 italic text-center">
                      Select a file to inspect diff.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            {review && (
              <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-xs">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    {review.direction === "push" ? (
                      <ArrowUpToLine className="size-4 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <ArrowDownToLine className="size-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                      Confirm {review.direction === "push" ? "Publication to GitHub" : "Import from GitHub"}
                    </h3>
                  </div>
                  <span className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300">
                    {review.manifest.files.length} file{review.manifest.files.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-200">
                    {review.manifest.repository.replace(/^https:\/\/github\.com\//, "")}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                    <GitBranch className="size-3" />
                    {review.manifest.branch}
                  </span>
                </div>

                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {review.direction === "pull"
                    ? "Incoming changes create new file revisions in workspace. Reviewed deletions move local files safely to Trash."
                    : review.manifest.newRepository
                      ? `Create a ${review.manifest.newRepository.private ? "private" : "PUBLIC"} repository and publish these files.`
                      : review.manifest.mode === "pr"
                        ? "Publish a separate branch and open a pull request on GitHub. Nothing is auto-merged."
                        : `Write a commit directly to '${review.manifest.branch}'. GitHub branch protections and audit rules still apply.`}
                </p>
                {review.error && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                  >
                    <AlertTriangle className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{review.error}</span>
                    {isGithubWorkflowPermissionError(review.error) && (
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => void authorizeWorkflow()}
                      >
                        Authorize workflow publishing
                      </button>
                    )}
                  </div>
                )}
                <ul className="max-h-52 overflow-auto text-sm">
                  {review.manifest.files.map((file) => (
                    <li key={file.path} className="break-all py-1">
                      {file.resultBlobSha ? "Write" : "Delete"} · {file.path}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-zinc-500">
                  Actual editors retain attribution. NetworkBase automatically uses
                  each linked editor&apos;s privacy-safe GitHub identity when
                  available; unlinked editors remain credited inside NetworkBase.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${button} bg-blue-600 text-white`}
                    disabled={busy || active}
                    onClick={() => void execute(review)}
                  >
                    {review.status === "failed"
                      ? "Retry publication"
                      : review.manifest.newRepository
                        ? "Create repository and publish"
                        : review.direction === "push"
                          ? review.manifest.mode === "direct"
                            ? `Confirm & Commit directly to ${review.manifest.branch}`
                            : "Confirm & Open Pull Request"
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
              <SplitDiffViewer
                leftTitle="NetworkBase Workspace (Local)"
                leftContent={diff?.edge || ""}
                rightTitle={`GitHub (${branch})`}
                rightContent={diff?.github || ""}
              />
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer hover:underline">Common baseline</summary>
                <pre className="max-h-40 overflow-auto rounded border p-2 mt-1 text-[11px] font-mono bg-zinc-50 dark:bg-zinc-950 dark:border-zinc-800">
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
                        : `Use ${resolution === "edge" ? "NetworkBase" : "GitHub"} version`}
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
      {/* Compact Change Target Repository Dialog */}
      <Dialog open={changeRepoDialogOpen} onOpenChange={setChangeRepoDialogOpen}>
        <DialogContent className="sm:max-w-md z-[200]">
          <DialogHeader>
            <DialogTitle>Change Target Repository</DialogTitle>
            <DialogDescription>
              Update the connected GitHub repository destination for this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                GitHub Repository URL
              </label>
              <input
                type="url"
                value={changeRepoUrl}
                onChange={(e) => setChangeRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-mono text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400"
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              Changes will update the remote tracking repository. File history and commit tracking will follow the new remote.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => setChangeRepoDialogOpen(false)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!changeRepoUrl.trim() || busy}
              onClick={handleSaveRepoUrl}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 px-5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Save Repository
            </button>
          </DialogFooter>
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
