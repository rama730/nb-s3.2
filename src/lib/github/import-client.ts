import type {
  GithubImportAccessState,
  GithubImportPreviewEntry,
  GithubImportRepoItem,
} from "@/lib/github/import-types";

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiFailure = {
  success: false;
  message: string;
  errorCode?: string;
};

async function fetchGithubImportApi<T>(path: string, params?: Record<string, string | number | null | undefined>) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? "GitHub import request failed." : payload.message || "GitHub import request failed.");
  }
  return payload.data;
}

export function fetchGithubImportAccessState() {
  return fetchGithubImportApi<
    GithubImportAccessState & { success: true }
  >("/api/v1/github/import/access-state");
}

export function fetchGithubImportRepositories(input: {
  cursor?: string | null;
  q?: string | null;
  perPage?: number | null;
}) {
  return fetchGithubImportApi<{
    success: true;
    items: GithubImportRepoItem[];
    cursor: string | null;
    hasMore: boolean;
  }>("/api/v1/github/import/repositories", input);
}

export function fetchGithubImportBranches(input: {
  repoUrl: string;
  installationId?: number | string | null;
}) {
  return fetchGithubImportApi<{
    success: true;
    branches: string[];
    authSource: string;
    installationId: number | null;
  }>("/api/v1/github/import/branches", input);
}

export function fetchGithubImportPreflight(input: {
  repoUrl: string;
  branch?: string | null;
  installationId?: number | string | null;
}) {
  return fetchGithubImportApi<{
    success: true;
    normalizedRepoUrl: string;
    branch: string;
    auth: {
      source: string;
      installationId: number | null;
    };
    repo: {
      id: number | null;
      fullName: string;
      visibility: "public" | "private" | null;
      isPrivate: boolean;
      defaultBranch: string | null;
      sizeKb: number | null;
    };
    summary: {
      rootFiles: number;
      rootFolders: number;
      ignored: number;
      tooLarge: number;
    };
    warnings: string[];
    metadata: Record<string, unknown>;
    checkedAt: string;
  }>("/api/v1/github/import/preflight", input);
}

export function fetchGithubImportPreviewRoot(input: {
  repoUrl: string;
  branch?: string | null;
  installationId?: number | string | null;
}) {
  return fetchGithubImportApi<{
    success: true;
    branch: string;
    rootEntries: GithubImportPreviewEntry[];
    normalizedRepoUrl: string;
    authSource: string;
    installationId: number | null;
  }>("/api/v1/github/import/preview-root", input);
}

export function fetchGithubImportPreviewFolder(input: {
  repoUrl: string;
  branch: string;
  path: string;
  installationId?: number | string | null;
}) {
  return fetchGithubImportApi<{
    success: true;
    entries: GithubImportPreviewEntry[];
  }>("/api/v1/github/import/preview-folder", input);
}

export function fetchGithubImportAnalysis(input: {
  repoUrl: string;
  installationId?: number | string | null;
}) {
  return fetchGithubImportApi<{
    success: true;
    result: {
      title: string;
      description: string;
      technologies: string[];
    } | null;
  }>("/api/v1/github/import/analyze", input);
}
