'use client';

import { detectPackageTechnologies, mergeDetectedTechnologies } from '@/lib/skills/repository-detection';

/**
 * Lightweight GitHub repo analyzer.
 * Fetches package.json and Doc to auto-detect tech stack.
 * Pure optimization: Single fetch per file, client-side parsing.
 */

interface RepoAnalysis {
    title: string;
    description: string;
    technologies: string[];
    detectedFramework: string | null;
}

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
    if (!owner || !repo) return result;
    const cleanRepo = repo.replace(/\.git$/, '');

    // Default title from repo name
    result.title = cleanRepo
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const rawHeaders: HeadersInit = {
        'Accept': 'application/vnd.github.v3.raw',
        ...(token && { 'Authorization': `Bearer ${token}` }),
    };

    // Parallel fetch: package.json AND Doc simultaneously
    // Use raw content headers to avoid base64 overhead and string limits
    // Optimization: Pass AbortSignal to cancel if user navigates away
    const [pkgResult, readmeResult] = await Promise.allSettled([
        fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/contents/package.json`, { headers: rawHeaders, signal }),
        fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/readme`, { headers: rawHeaders, signal }),
    ]);

    // Process package.json
    if (pkgResult.status === 'fulfilled' && pkgResult.value.ok) {
        try {
            const pkg = await pkgResult.value.json();
            const detected = detectPackageTechnologies(pkg);
            result.technologies = detected.technologies;
            result.detectedFramework = detected.detectedFramework;

            if (pkg.description) result.description = pkg.description;
        } catch { /* Silent */ }
    }

    // Process Doc (Raw text - skip atob memory spike)
    if (!result.description && readmeResult.status === 'fulfilled' && readmeResult.value.ok) {
        try {
            const content = await readmeResult.value.text();
            const lines = content.split('\n').filter((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('!'));
            if (lines.length > 0) {
                result.description = lines.slice(0, 2).join(' ').substring(0, 250);
            }
        } catch { /* Silent */ }
    }

    result.technologies = mergeDetectedTechnologies(['GitHub'], result.technologies);

    return result;
}
