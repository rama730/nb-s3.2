/**
 * GitHub repo preview helpers.
 * Pure optimization: metadata-only fetches (no blobs), minimal parsing, client-safe.
 */

import { normalizeGithubRepoUrl } from "@/lib/github/repo-validation";

export type GitHubRepoRef = { owner: string; repo: string };

export type GitHubContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number | null;
};

export function parseGithubRepo(repoUrl: string): GitHubRepoRef | null {
  const normalized = normalizeGithubRepoUrl(repoUrl);
  if (!normalized) return null;
  const url = new URL(normalized);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

function makeHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const DEFAULT_FETCH_TIMEOUT_MS = (() => {
  const v = Number(process.env.GITHUB_API_TIMEOUT_MS || 12000);
  return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 12000;
})();

function createTimeoutSignal(external?: AbortSignal, timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("GitHub request timed out")), timeoutMs);

  const abortFromExternal = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) abortFromExternal();
    else external.addEventListener("abort", abortFromExternal, { once: true });
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", abortFromExternal);
  };

  return { signal: controller.signal, cleanup };
}

export async function fetchRepoMeta(args: {
  owner: string;
  repo: string;
  token?: string;
  signal?: AbortSignal;
}): Promise<{
  defaultBranch: string | null;
  isPrivate: boolean | null;
  visibility: "public" | "private" | null;
  sizeKb: number | null;
  fullName: string | null;
  repoId: number | null;
}> {
  const { owner, repo, token, signal } = args;
  const timeout = createTimeoutSignal(signal);
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: makeHeaders(token),
      signal: timeout.signal,
    });
  } finally {
    timeout.cleanup();
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Repository not found or private (404). Check URL/permissions.`);
    }
    // Keep error message compact + actionable.
    throw new Error(`GitHub repo lookup failed (${res.status})`);
  }

  const json = (await res.json()) as {
    id?: number;
    full_name?: string;
    default_branch?: string;
    private?: boolean;
    size?: number;
  };
  const isPrivate = typeof json.private === "boolean" ? json.private : null;
  return {
    defaultBranch: json.default_branch || null,
    isPrivate,
    // `null` means GitHub did not return privacy info, so visibility is unknown.
    visibility: isPrivate === true ? "private" : isPrivate === false ? "public" : null,
    sizeKb: typeof json.size === "number" ? json.size : null,
    fullName: typeof json.full_name === "string" ? json.full_name : null,
    repoId: typeof json.id === "number" ? json.id : null,
  };
}

export async function fetchContents(args: {
  owner: string;
  repo: string;
  token?: string;
  ref?: string;
  path?: string; // folder path, "" for root
  signal?: AbortSignal;
}): Promise<GitHubContentEntry[]> {
  const { owner, repo, token, ref, path = "", signal } = args;
  const cleanPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`
  );
  if (ref) url.searchParams.set("ref", ref);
  const timeout = createTimeoutSignal(signal);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: makeHeaders(token),
      signal: timeout.signal,
    });
  } finally {
    timeout.cleanup();
  }

  if (!res.ok) {
    throw new Error(`GitHub contents fetch failed (${res.status})`);
  }

  const json = (await res.json()) as any;
  const arr = Array.isArray(json) ? json : [];

  // Map to the minimal shape we need.
  const entries: GitHubContentEntry[] = arr
    .map((e: any) => {
      const t = e?.type === "dir" ? "dir" : e?.type === "file" ? "file" : null;
      if (!t) return null;
      return {
        name: String(e.name || ""),
        path: String(e.path || ""),
        type: t,
        size: typeof e.size === "number" ? e.size : null,
      } satisfies GitHubContentEntry;
    })
    .filter(Boolean) as GitHubContentEntry[];

  // Stable ordering: dirs first, then files, then name.
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  return entries;
}
