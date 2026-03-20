'use server';

import { createClient } from '@/lib/supabase/server';
import { fetchContents, fetchRepoMeta, GithubApiError, parseGithubRepo } from '@/lib/github/repo-preview';
import { openGithubImportToken, sealGithubImportToken } from '@/lib/github/repo-security';
import { isTooLarge, shouldIgnorePath } from '@/lib/import/import-filters';
import { normalizeGithubBranch, normalizeGithubRepoUrl } from '@/lib/github/repo-validation';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { resolveGithubRepoAccess } from '@/lib/github/auth-resolver';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
import { logger } from '@/lib/logger';
import { getGithubImportAccessState } from '@/lib/github/import-access-state';

type PreviewEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number | null;
  excludedReason?: 'ignored' | 'tooLarge';
};

type GithubAuthSession = {
  userId: string;
  oauthToken: string | null;
};

type GithubRepoPickerItem = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  visibility: 'public' | 'private';
  defaultBranch: string | null;
  description: string | null;
  updatedAt: string | null;
};

const TECH_PATTERNS: Record<string, string[]> = {
  'React': ['react', 'react-dom'],
  'Next.js': ['next'],
  'Vue': ['vue'],
  'Nuxt': ['nuxt'],
  'Angular': ['@angular/core'],
  'Svelte': ['svelte'],
  'Express': ['express'],
  'Fastify': ['fastify'],
  'NestJS': ['@nestjs/core'],
  'TypeScript': ['typescript'],
  'Tailwind CSS': ['tailwindcss'],
  'Prisma': ['prisma', '@prisma/client'],
  'Drizzle': ['drizzle-orm'],
  'PostgreSQL': ['pg', 'postgres'],
  'MongoDB': ['mongodb', 'mongoose'],
  'Redis': ['redis', 'ioredis'],
  'GraphQL': ['graphql', '@apollo/server'],
  'tRPC': ['@trpc/server'],
  'Supabase': ['@supabase/supabase-js'],
  'Firebase': ['firebase'],
  'AWS SDK': ['aws-sdk', '@aws-sdk/client-s3'],
  'Vite': ['vite'],
  'Webpack': ['webpack'],
  'Jest': ['jest'],
  'Vitest': ['vitest'],
  'Playwright': ['playwright', '@playwright/test'],
};

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const REQUEST_TIMEOUT_MS = (() => {
  const v = Number(process.env.GITHUB_API_TIMEOUT_MS || 12000);
  return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 12000;
})();
const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);

const CACHE_TTL_MS = {
  repositories: 15_000,
  branches: 20_000,
  preflight: 10_000,
  previewRoot: 10_000,
  previewFolder: 10_000,
  analyze: 20_000,
} as const;

const actionCache = new Map<string, { expiresAtMs: number; value: unknown }>();

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCachedValue<T>(cacheKey: string): T | null {
  const entry = actionCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    actionCache.delete(cacheKey);
    return null;
  }
  return entry.value as T;
}

function setCachedValue(cacheKey: string, value: unknown, ttlMs: number) {
  actionCache.set(cacheKey, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
}

async function withCachedValue<T>(cacheKey: string, ttlMs: number, task: () => Promise<T>): Promise<T> {
  const cached = getCachedValue<T>(cacheKey);
  if (cached !== null) return cached;
  const value = await runInFlightDeduped(`github:actions:${cacheKey}`, task);
  setCachedValue(cacheKey, value, ttlMs);
  return value;
}

function createTimeoutSignal(timeoutMs: number = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('GitHub request timed out')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchGithubJson<T>(
  url: string,
  init: RequestInit,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<{ data: T; status: number; headers: Headers }> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let attempt = 0;

  while (true) {
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: timeout.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers || {}),
        },
      });

      const bodyText = await response.text();
      let body: unknown = null;
      if (bodyText.trim().length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }

      if (response.ok) {
        return { data: body as T, status: response.status, headers: response.headers };
      }

      const message =
        typeof body === 'object' && body && 'message' in body
          ? String((body as Record<string, unknown>).message || '')
          : typeof body === 'string'
            ? body
            : '';
      const retryable = RETRYABLE_STATUS.has(response.status) || /rate limit/i.test(message);
      if (attempt < retries && retryable) {
        const retryAfter = Number(response.headers.get('retry-after') || '0');
        const jitter = Math.floor(Math.random() * 150);
        const delayMs =
          retryAfter > 0
            ? retryAfter * 1000 + jitter
            : Math.min(2000, 250 * (attempt + 1) * (attempt + 1) + jitter);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }

      throw new Error(`GitHub request failed (${response.status})${message ? `: ${message}` : ''}`);
    } catch (error) {
      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * 150);
        const delayMs = Math.min(2000, 250 * (attempt + 1) * (attempt + 1) + jitter);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }
      throw error;
    } finally {
      timeout.cleanup();
    }
  }
}

async function getAuthorizedGithubSession() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    return { ok: false as const, error: 'Unauthorized. Please sign in first.' };
  }
  const rateLimit = await consumeRateLimit(
    `github:preview:${user.id}`,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!rateLimit.allowed) {
    return { ok: false as const, error: 'Too many GitHub requests. Please wait a minute and retry.' };
  }
  return {
    ok: true as const,
    session: {
      userId: user.id,
      oauthToken: session?.provider_token || null,
    } satisfies GithubAuthSession,
  };
}

function decorateEntry(e: { name: string; path: string; type: 'file' | 'dir'; size?: number | null }): PreviewEntry {
  if (shouldIgnorePath(e.path)) return { ...e, excludedReason: 'ignored' };
  if (e.type === 'file' && isTooLarge(e.size)) return { ...e, excludedReason: 'tooLarge' };
  return e;
}

function parseCursor(cursor: string | null | undefined) {
  if (!cursor) return 1;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = Number(decoded);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  } catch {
    // Ignore invalid cursor and reset to first page.
  }
  return 1;
}

function encodeCursor(page: number): string {
  return Buffer.from(String(page)).toString('base64');
}

function normalizeRepoItem(item: any): GithubRepoPickerItem | null {
  const htmlUrl = normalizeGithubRepoUrl(String(item?.html_url || ''));
  const fullName = String(item?.full_name || '');
  if (!htmlUrl || !fullName) return null;
  const [owner, name] = fullName.split('/');
  if (!owner || !name) return null;

  const isPrivate = item?.private === true;
  return {
    id: Number(item?.id) || 0,
    owner,
    name,
    fullName,
    htmlUrl,
    private: isPrivate,
    visibility: isPrivate ? 'private' : 'public',
    defaultBranch: typeof item?.default_branch === 'string' ? item.default_branch : null,
    description: typeof item?.description === 'string' ? item.description : null,
    updatedAt: typeof item?.updated_at === 'string' ? item.updated_at : null,
  };
}

function matchRepoQuery(repo: GithubRepoPickerItem, q: string | null | undefined) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return true;
  const haystack = `${repo.fullName} ${repo.description || ''}`.toLowerCase();
  return haystack.includes(query);
}

async function resolveAuthForRepo(
  auth: GithubAuthSession,
  repoUrl: string,
  preferredInstallationId?: number | string | null,
  sealedImportToken?: unknown,
) {
  return await resolveGithubRepoAccess({
    repoUrl,
    preferredInstallationId,
    oauthToken: auth.oauthToken,
    sealedImportToken,
  });
}

function isEmptyGithubRepositoryError(
  error: unknown,
  repoMeta: { sizeKb: number | null } | null | undefined,
  path: string,
) {
  return (
    error instanceof GithubApiError &&
    error.status === 404 &&
    path.trim().length === 0 &&
    (repoMeta?.sizeKb === 0 || repoMeta?.sizeKb === null)
  );
}

function normalizeGithubImportError(error: unknown) {
  if (error instanceof GithubApiError) {
    if (error.status === 404) {
      return 'Repository files could not be loaded. The repository may be empty, the branch may not exist yet, or access is missing.';
    }
    if (error.status === 409) {
      return 'GitHub cannot read this repository yet. It may be empty or have no default branch.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'GitHub import failed.';
}

export async function listGithubRepositories(input?: {
  cursor?: string | null;
  q?: string | null;
  perPage?: number | null;
  sealedImportToken?: unknown;
}) {
  const authResult = await getAuthorizedGithubSession();
  if (!authResult.ok) return { success: false as const, error: authResult.error };
  const { session } = authResult;
  const oauthToken = session.oauthToken || openGithubImportToken(input?.sealedImportToken);

  if (!oauthToken) {
    return {
      success: false as const,
      error: 'GitHub repository access is not available. Connect or reconnect GitHub to browse repositories.',
    };
  }

  const page = parseCursor(input?.cursor);
  const perPage = clampNumber(Number(input?.perPage || 20), 5, 50);
  const query = (input?.q || '').trim();
  const cacheKey = `repos:${session.userId}:${page}:${perPage}:${query.toLowerCase()}`;

  return await withCachedValue(cacheKey, CACHE_TTL_MS.repositories, async () => {
    const startedAt = Date.now();
    let url: URL;
    const headers: HeadersInit = {
      Authorization: `Bearer ${oauthToken}`,
    };

    if (query) {
      const userResponse = await fetchGithubJson<{ login?: string }>(
        'https://api.github.com/user',
        {
          method: 'GET',
          headers,
        },
      );
      const login = typeof userResponse.data?.login === 'string' ? userResponse.data.login.trim() : '';
      url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('order', 'desc');
      const q = login
        ? `${query} user:${login} in:name,description`
        : `${query} in:name,description`;
      url.searchParams.set('q', q);
    } else {
      url = new URL('https://api.github.com/user/repos');
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('direction', 'desc');
      url.searchParams.set('affiliation', 'owner,collaborator,organization_member');
    }

    const { data } = await fetchGithubJson<any[] | { items?: any[] }>(
      url.toString(),
      {
        method: 'GET',
        headers,
      },
    );

    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    const repos = items
      .map(normalizeRepoItem)
      .filter((item): item is GithubRepoPickerItem => !!item)
      .filter((repo) => matchRepoQuery(repo, query));

    const hasMore = items.length >= perPage;
    logger.metric('github.repo_picker.result', {
      userId: session.userId,
      page,
      perPage,
      queryLength: query.length,
      count: repos.length,
      hasMore,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true as const,
      items: repos,
      cursor: hasMore ? encodeCursor(page + 1) : null,
      hasMore,
    };
  });
}

export async function listGithubBranches(args: {
  repoUrl: string;
  installationId?: number | string | null;
  sealedImportToken?: unknown;
}) {
  const authResult = await getAuthorizedGithubSession();
  if (!authResult.ok) return { success: false as const, error: authResult.error };
  const { session } = authResult;

  const normalizedRepoUrl = normalizeGithubRepoUrl(args.repoUrl || '');
  if (!normalizedRepoUrl) {
    return { success: false as const, error: 'Invalid repository URL.' };
  }

  const cacheKey = `branches:${session.userId}:${normalizedRepoUrl}:${args.installationId ?? 'none'}`;
  return await withCachedValue(cacheKey, CACHE_TTL_MS.branches, async () => {
    const startedAt = Date.now();
    const parsed = parseGithubRepo(normalizedRepoUrl);
    if (!parsed) return { success: false as const, error: 'Invalid repository URL.' };

    const access = await resolveAuthForRepo(session, normalizedRepoUrl, args.installationId, args.sealedImportToken);
    const token = access.token || undefined;
    const { data } = await fetchGithubJson<Array<{ name?: string }>>(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100`,
      {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );

    const branches = (Array.isArray(data) ? data : [])
      .map((entry) => (typeof entry?.name === 'string' ? entry.name : ''))
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b));

    logger.metric('github.branch_picker.result', {
      userId: session.userId,
      repoUrl: normalizedRepoUrl,
      authSource: access.source,
      installationId: access.installationId,
      count: branches.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true as const,
      branches,
      authSource: access.source,
      installationId: access.installationId,
    };
  });
}

export async function preflightGithubImport(args: {
  repoUrl: string;
  branch?: string | null;
  installationId?: number | string | null;
  sealedImportToken?: unknown;
}) {
  const authResult = await getAuthorizedGithubSession();
  if (!authResult.ok) return { success: false as const, error: authResult.error };
  const { session } = authResult;

  const normalizedRepoUrl = normalizeGithubRepoUrl(args.repoUrl || '');
  if (!normalizedRepoUrl) {
    return { success: false as const, error: 'Invalid repository URL.' };
  }

  const cacheKey = `preflight:${session.userId}:${normalizedRepoUrl}:${args.branch || ''}:${args.installationId ?? 'none'}`;
  return await withCachedValue(cacheKey, CACHE_TTL_MS.preflight, async () => {
    const startedAt = Date.now();
    const parsed = parseGithubRepo(normalizedRepoUrl);
    if (!parsed) {
      return { success: false as const, error: 'Invalid repository URL.' };
    }

    const access = await resolveAuthForRepo(session, normalizedRepoUrl, args.installationId, args.sealedImportToken);
    const token = access.token || undefined;
    const meta = await fetchRepoMeta({ ...parsed, token });

    if (meta.isPrivate === true && !token) {
      return {
        success: false as const,
        error: 'Repository is private. Connect GitHub or install GitHub App access and retry.',
      };
    }

    const branch = normalizeGithubBranch(args.branch || meta.defaultBranch || 'main');
    if (!branch) {
      return { success: false as const, error: 'Invalid branch name.' };
    }

    let rawRootEntries: Array<{ name: string; path: string; type: 'file' | 'dir'; size?: number | null }> = [];
    try {
      rawRootEntries = await fetchContents({
        ...parsed,
        token,
        ref: branch,
        path: '',
      });
    } catch (error) {
      if (!isEmptyGithubRepositoryError(error, meta, '')) {
        throw error;
      }
      rawRootEntries = [];
    }

    const rootEntries = rawRootEntries.map(decorateEntry);

    const summary = rootEntries.reduce(
      (acc, entry) => {
        if (entry.type === 'dir') acc.rootFolders += 1;
        if (entry.type === 'file') acc.rootFiles += 1;
        if (entry.excludedReason === 'ignored') acc.ignored += 1;
        if (entry.excludedReason === 'tooLarge') acc.tooLarge += 1;
        return acc;
      },
      { rootFiles: 0, rootFolders: 0, ignored: 0, tooLarge: 0 },
    );

    const warnings: string[] = [];
    if (summary.ignored > 0) warnings.push(`${summary.ignored} root path(s) will be ignored by import filters.`);
    if (summary.tooLarge > 0) warnings.push(`${summary.tooLarge} root file(s) exceed the file-size limit and will be skipped.`);
    if (summary.rootFiles === 0 && summary.rootFolders === 0) {
      warnings.push('This repository does not contain files on the selected branch yet.');
    }
    if (typeof meta.sizeKb === 'number' && meta.sizeKb > 500_000) {
      warnings.push('Repository is large (>500 MB). Import may take longer than usual.');
    }

    logger.metric('github.preflight.result', {
      userId: session.userId,
      repoUrl: normalizedRepoUrl,
      branch,
      authSource: access.source,
      installationId: access.installationId,
      rootFiles: summary.rootFiles,
      rootFolders: summary.rootFolders,
      ignored: summary.ignored,
      tooLarge: summary.tooLarge,
      warnings: warnings.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true as const,
      normalizedRepoUrl,
      branch,
      auth: {
        source: access.source,
        installationId: access.installationId,
      },
      repo: {
        id: meta.repoId,
        fullName: meta.fullName || `${parsed.owner}/${parsed.repo}`,
        visibility: meta.visibility,
        isPrivate: meta.isPrivate === true,
        defaultBranch: meta.defaultBranch,
        sizeKb: meta.sizeKb,
      },
      summary,
      warnings,
      metadata: {
        githubRepoId: meta.repoId,
        githubInstallationId: access.installationId,
        githubOwner: parsed.owner,
        githubName: parsed.repo,
        githubVisibility: meta.visibility,
      },
      checkedAt: new Date().toISOString(),
    };
  });
}

export async function previewGithubRepoRootAction(
  repoUrl: string,
  preferredBranch?: string | null,
  preferredInstallationId?: number | string | null,
  sealedImportToken?: unknown,
) {
  const authResult = await getAuthorizedGithubSession();
  if (!authResult.ok) return { success: false as const, error: authResult.error };
  const { session } = authResult;

  const normalizedRepoUrl = normalizeGithubRepoUrl(repoUrl || '');
  if (!normalizedRepoUrl) return { success: false as const, error: 'Invalid repository URL.' };

  const cacheKey = `preview-root:${session.userId}:${normalizedRepoUrl}:${preferredBranch || ''}:${preferredInstallationId ?? 'none'}`;
  return await withCachedValue(cacheKey, CACHE_TTL_MS.previewRoot, async () => {
    try {
      const parsed = parseGithubRepo(normalizedRepoUrl);
      if (!parsed) return { success: false as const, error: 'Invalid repository URL.' };

      const access = await resolveAuthForRepo(session, normalizedRepoUrl, preferredInstallationId, sealedImportToken);
      const token = access.token || undefined;
      const meta = await fetchRepoMeta({ ...parsed, token });
      const branch = normalizeGithubBranch(preferredBranch || meta.defaultBranch || 'main');
      if (!branch) return { success: false as const, error: 'Invalid branch name.' };

      let rawRootEntries: Array<{ name: string; path: string; type: 'file' | 'dir'; size?: number | null }> = [];
      try {
        rawRootEntries = await fetchContents({ ...parsed, token, ref: branch, path: '' });
      } catch (error) {
        if (!isEmptyGithubRepositoryError(error, meta, '')) {
          throw error;
        }
        rawRootEntries = [];
      }

      const rootEntries = rawRootEntries.map(decorateEntry);
      return {
        success: true as const,
        branch,
        rootEntries,
        normalizedRepoUrl,
        authSource: access.source,
        installationId: access.installationId,
      };
    } catch (e: any) {
      return { success: false as const, error: normalizeGithubImportError(e) };
    }
  });
}

export async function previewGithubFolderAction(
  repoUrl: string,
  branch: string,
  folderPath: string,
  preferredInstallationId?: number | string | null,
  sealedImportToken?: unknown,
) {
  const authResult = await getAuthorizedGithubSession();
  if (!authResult.ok) return { success: false as const, error: authResult.error };
  const { session } = authResult;

  const normalizedRepoUrl = normalizeGithubRepoUrl(repoUrl || '');
  if (!normalizedRepoUrl) return { success: false as const, error: 'Invalid repository URL.' };
  const normalizedBranch = normalizeGithubBranch(branch);
  if (!normalizedBranch) return { success: false as const, error: 'Invalid branch name.' };

  const normalizedPath = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const cacheKey = `preview-folder:${session.userId}:${normalizedRepoUrl}:${normalizedBranch}:${normalizedPath}:${preferredInstallationId ?? 'none'}`;
  return await withCachedValue(cacheKey, CACHE_TTL_MS.previewFolder, async () => {
    try {
      const parsed = parseGithubRepo(normalizedRepoUrl);
      if (!parsed) return { success: false as const, error: 'Invalid repository URL.' };

      const access = await resolveAuthForRepo(session, normalizedRepoUrl, preferredInstallationId, sealedImportToken);
      const token = access.token || undefined;
      const entries = (await fetchContents({
        ...parsed,
        token,
        ref: normalizedBranch,
        path: normalizedPath,
      })).map(decorateEntry);
      return { success: true as const, entries };
    } catch (e: any) {
      return { success: false as const, error: normalizeGithubImportError(e) };
    }
  });
}

export async function analyzeGithubRepoAction(
  repoUrl: string,
  preferredInstallationId?: number | string | null,
  sealedImportToken?: unknown,
) {
  const authResult = await getAuthorizedGithubSession();
  if (!authResult.ok) {
    return {
      success: false as const,
      error: authResult.error,
      result: null,
    };
  }
  const { session } = authResult;

  const normalizedRepoUrl = normalizeGithubRepoUrl(repoUrl || '');
  if (!normalizedRepoUrl) {
    return {
      success: false as const,
      error: 'Invalid repository URL.',
      result: null,
    };
  }

  const parsed = parseGithubRepo(normalizedRepoUrl);
  if (!parsed) {
    return {
      success: false as const,
      error: 'Invalid repository URL.',
      result: null,
    };
  }

  const cacheKey = `analyze:${session.userId}:${normalizedRepoUrl}:${preferredInstallationId ?? 'none'}`;
  return await withCachedValue(cacheKey, CACHE_TTL_MS.analyze, async () => {
    const title = parsed.repo
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    try {
      const access = await resolveAuthForRepo(session, normalizedRepoUrl, preferredInstallationId, sealedImportToken);
      const token = access.token || undefined;
      const rawHeaders: HeadersInit = {
        Accept: 'application/vnd.github.v3.raw',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const timeout = createTimeoutSignal();
      const [pkgResult, readmeResult] = await Promise.allSettled([
        fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/package.json`, { headers: rawHeaders, signal: timeout.signal }),
        fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, { headers: rawHeaders, signal: timeout.signal }),
      ]);
      timeout.cleanup();

      let description = '';
      const technologies: string[] = [];
      let detectedFramework: string | null = null;

      if (pkgResult.status === 'fulfilled' && pkgResult.value.ok) {
        try {
          const pkg = JSON.parse(await pkgResult.value.text());
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
            if (patterns.length && patterns.some((p) => deps[p])) technologies.push(tech);
          }

          const frameworkOrder = ['next', 'nuxt', '@angular/core', 'vue', 'svelte', 'react', 'express'];
          const frameworkNames: Record<string, string> = {
            next: 'Next.js',
            nuxt: 'Nuxt',
            '@angular/core': 'Angular',
            vue: 'Vue',
            svelte: 'Svelte',
            react: 'React',
            express: 'Express',
          };

          for (const key of frameworkOrder) {
            if (deps[key]) {
              detectedFramework = frameworkNames[key];
              break;
            }
          }

          if (pkg.description) description = pkg.description;
        } catch {
          // Best-effort analysis only.
        }
      }

      if (!description && readmeResult.status === 'fulfilled' && readmeResult.value.ok) {
        try {
          const content = await readmeResult.value.text();
          const lines = content
            .split('\n')
            .filter((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('!'));
          if (lines.length > 0) description = lines.slice(0, 2).join(' ').substring(0, 250);
        } catch {
          // Best-effort analysis only.
        }
      }

      return {
        success: true as const,
        result: {
          title,
          description,
          technologies: technologies.slice(0, 6),
          detectedFramework,
          authSource: access.source,
        },
      };
    } catch (e: any) {
      return {
        success: false as const,
        error: typeof e?.message === 'string' ? e.message : 'Failed to analyze repository.',
        result: null,
      };
    }
  });
}

export async function sealGithubProviderTokenAction(providerToken: string) {
  const token = (providerToken || '').trim();
  if (!token) {
    return { success: false as const, error: 'GitHub provider token is missing.' };
  }

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { success: false as const, error: 'Unauthorized. Please sign in first.' };
  }

  const sealed = sealGithubImportToken(token);
  if (!sealed) {
    return { success: false as const, error: 'GitHub import token encryption is not configured.' };
  }

  return {
    success: true as const,
    sealed,
  };
}

export async function getGithubImportAccessStateAction() {
  return getGithubImportAccessState();
}
