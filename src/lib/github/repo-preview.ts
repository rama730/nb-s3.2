/**
 * GitHub repo preview helpers.
 * Pure optimization: metadata-only fetches (no blobs), minimal parsing, client-safe.
 */

export type GitHubRepoRef = { owner: string; repo: string };

export type GitHubContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number | null;
};

export function parseGithubRepo(repoUrl: string): GitHubRepoRef | null {
  const raw = (repoUrl || "").trim().replace(/\/+$/, ""); // Pre-strip trailing slashes
  if (!raw) return null;

  // STRICT Regex: github.com/owner/repo
  // Must have two path segments after github.com.
  const m = raw.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
  if (!m) {
    // Check if it looks like a profile (github.com/owner)
    if (/github\.com\/[^\/]+$/.test(raw)) {
      throw new Error("This looks like a user profile. Please provide a full repository URL (e.g., github.com/owner/repo).");
    }
    return null;
  }

  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");

  if (!owner || !repo) return null;
  return { owner, repo };
}

function makeHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchRepoMeta(args: {
  owner: string;
  repo: string;
  token?: string;
  signal?: AbortSignal;
}): Promise<{ defaultBranch: string | null }> {
  const { owner, repo, token, signal } = args;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: makeHeaders(token),
    signal,
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Repository not found or private (404). Check URL/permissions.`);
    }
    // Keep error message compact + actionable.
    throw new Error(`GitHub repo lookup failed (${res.status})`);
  }

  const json = (await res.json()) as { default_branch?: string };
  return { defaultBranch: json.default_branch || null };
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

  const res = await fetch(url.toString(), {
    headers: makeHeaders(token),
    signal,
  });

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

