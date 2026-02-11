'use server';

import { createClient } from '@/lib/supabase/server';
import { fetchContents, fetchRepoMeta, parseGithubRepo } from '@/lib/github/repo-preview';
import { isTooLarge, shouldIgnorePath } from '@/lib/import/import-filters';
import { normalizeGithubBranch } from '@/lib/github/repo-validation';

type PreviewEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number | null;
  excludedReason?: 'ignored' | 'tooLarge';
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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const PREVIEW_RATE_BUCKET = new Map<string, number[]>();
const ANALYZE_TIMEOUT_MS = (() => {
  const v = Number(process.env.GITHUB_API_TIMEOUT_MS || 12000);
  return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 12000;
})();

function checkRateLimit(userId: string) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = PREVIEW_RATE_BUCKET.get(userId) || [];
  const next = existing.filter((ts) => ts > cutoff);
  if (next.length >= RATE_LIMIT_MAX_REQUESTS) return false;
  next.push(now);
  PREVIEW_RATE_BUCKET.set(userId, next);
  if (PREVIEW_RATE_BUCKET.size > 5000) {
    // Opportunistic cleanup for long-running processes.
    for (const [key, arr] of PREVIEW_RATE_BUCKET.entries()) {
      if (arr.length === 0 || arr[arr.length - 1] < cutoff) PREVIEW_RATE_BUCKET.delete(key);
    }
  }
  return true;
}

async function getAuthorizedGithubSession() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    return { ok: false as const, error: 'Unauthorized. Please sign in first.' };
  }
  if (!checkRateLimit(user.id)) {
    return { ok: false as const, error: 'Too many GitHub requests. Please wait a minute and retry.' };
  }
  return { ok: true as const, userId: user.id, token: session?.provider_token || undefined };
}

function createTimeoutSignal(timeoutMs: number = ANALYZE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('GitHub request timed out')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function decorateEntry(e: { name: string; path: string; type: 'file' | 'dir'; size?: number | null }): PreviewEntry {
  if (shouldIgnorePath(e.path)) return { ...e, excludedReason: 'ignored' };
  if (e.type === 'file' && isTooLarge(e.size)) return { ...e, excludedReason: 'tooLarge' };
  return e;
}

export async function previewGithubRepoRootAction(repoUrl: string, preferredBranch?: string | null) {
  const auth = await getAuthorizedGithubSession();
  if (!auth.ok) return { success: false as const, error: auth.error };

  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) return { success: false as const, error: 'Invalid repository URL.' };

  try {
    const token = auth.token;
    const meta = await fetchRepoMeta({ ...parsed, token });
    const branch = normalizeGithubBranch(preferredBranch || meta.defaultBranch || 'main');
    if (!branch) return { success: false as const, error: 'Invalid branch name.' };
    const rootEntries = (await fetchContents({ ...parsed, token, ref: branch, path: '' })).map(decorateEntry);
    return {
      success: true as const,
      branch,
      rootEntries,
      normalizedRepoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
    };
  } catch (e: any) {
    return { success: false as const, error: typeof e?.message === 'string' ? e.message : 'Failed to preview repository.' };
  }
}

export async function previewGithubFolderAction(repoUrl: string, branch: string, folderPath: string) {
  const auth = await getAuthorizedGithubSession();
  if (!auth.ok) return { success: false as const, error: auth.error };

  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) return { success: false as const, error: 'Invalid repository URL.' };
  const normalizedBranch = normalizeGithubBranch(branch);
  if (!normalizedBranch) return { success: false as const, error: 'Invalid branch name.' };

  try {
    const token = auth.token;
    const entries = (await fetchContents({
      ...parsed,
      token,
      ref: normalizedBranch,
      path: folderPath || '',
    })).map(decorateEntry);
    return { success: true as const, entries };
  } catch (e: any) {
    return { success: false as const, error: typeof e?.message === 'string' ? e.message : 'Failed to load folder.' };
  }
}

export async function analyzeGithubRepoAction(repoUrl: string) {
  const auth = await getAuthorizedGithubSession();
  if (!auth.ok) {
    return {
      success: false as const,
      error: auth.error,
      result: null,
    };
  }

  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) {
    return {
      success: false as const,
      error: 'Invalid repository URL.',
      result: null,
    };
  }

  const title = parsed.repo
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  try {
    const token = auth.token;
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
        // Keep best-effort behavior
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
        // Keep best-effort behavior
      }
    }

    return {
      success: true as const,
      result: {
        title,
        description,
        technologies: technologies.slice(0, 6),
        detectedFramework,
      },
    };
  } catch (e: any) {
    return {
      success: false as const,
      error: typeof e?.message === 'string' ? e.message : 'Failed to analyze repository.',
      result: null,
    };
  }
}
