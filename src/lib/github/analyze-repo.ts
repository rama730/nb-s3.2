'use client';

/**
 * Lightweight GitHub repo analyzer.
 * Fetches package.json and README to auto-detect tech stack.
 * Pure optimization: Single fetch per file, client-side parsing.
 */

interface RepoAnalysis {
    title: string;
    description: string;
    technologies: string[];
    detectedFramework: string | null;
}

// Tech detection patterns from package.json dependencies
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
    'Docker': [], // Detected via Dockerfile
    'Vite': ['vite'],
    'Webpack': ['webpack'],
    'Jest': ['jest'],
    'Vitest': ['vitest'],
    'Playwright': ['playwright', '@playwright/test'],
};

/**
 * Analyze a GitHub repository to extract metadata.
 * Pure optimization: Parallel fetches, early returns, minimal processing.
 */
export async function analyzeGitHubRepo(repoUrl: string, token?: string, signal?: AbortSignal): Promise<RepoAnalysis> {
    const result: RepoAnalysis = {
        title: '',
        description: '',
        technologies: [],
        detectedFramework: null,
    };

    // Extract owner/repo from URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) return result;

    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, '');

    // Default title from repo name
    result.title = cleanRepo
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const rawHeaders: HeadersInit = {
        'Accept': 'application/vnd.github.v3.raw',
        ...(token && { 'Authorization': `Bearer ${token}` }),
    };

    // Parallel fetch: package.json AND README simultaneously
    // Use raw content headers to avoid base64 overhead and string limits
    // Optimization: Pass AbortSignal to cancel if user navigates away
    const [pkgResult, readmeResult] = await Promise.allSettled([
        fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/contents/package.json`, { headers: rawHeaders, signal }),
        fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/readme`, { headers: rawHeaders, signal }),
    ]);

    // Process package.json (Raw text)
    if (pkgResult.status === 'fulfilled' && pkgResult.value.ok) {
        try {
            const pkg = JSON.parse(await pkgResult.value.text());
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            // Detect technologies & framework in a single pass
            const frameworkOrder = ['next', 'nuxt', '@angular/core', 'vue', 'svelte', 'react', 'express'];
            const frameworkNames: Record<string, string> = {
                'next': 'Next.js', 'nuxt': 'Nuxt', '@angular/core': 'Angular',
                'vue': 'Vue', 'svelte': 'Svelte', 'react': 'React', 'express': 'Express',
            };

            for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
                if (patterns.length && patterns.some((p) => deps[p])) {
                    result.technologies.push(tech);
                }
            }

            for (const key of frameworkOrder) {
                if (deps[key]) {
                    result.detectedFramework = frameworkNames[key];
                    break;
                }
            }

            if (pkg.description) result.description = pkg.description;
        } catch { /* Silent */ }
    }

    // Process README (Raw text - skip atob memory spike)
    if (!result.description && readmeResult.status === 'fulfilled' && readmeResult.value.ok) {
        try {
            const content = await readmeResult.value.text();
            const lines = content.split('\n').filter((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('!'));
            if (lines.length > 0) {
                result.description = lines.slice(0, 2).join(' ').substring(0, 250);
            }
        } catch { /* Silent */ }
    }

    // Limit technologies
    result.technologies = result.technologies.slice(0, 6);

    return result;
}
