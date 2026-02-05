'use client';

/**
 * Analyze uploaded folder to auto-detect project metadata.
 * Scans for package.json and README.md in the FileList.
 * Pure client-side - no server calls needed.
 */

export interface FolderAnalysis {
    title: string;
    description: string;
    technologies: string[];
    detectedFramework: string | null;
}

// Tech detection patterns (same as GitHub analyzer)
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
    'Vite': ['vite'],
    'Jest': ['jest'],
    'Vitest': ['vitest'],
};

/**
 * Analyze a folder from FileList to extract metadata.
 * Pure optimization: Early break, parallel reads, minimal iteration.
 */
export async function analyzeUploadedFolder(files: FileList, signal?: AbortSignal): Promise<FolderAnalysis> {
    const result: FolderAnalysis = {
        title: '',
        description: '',
        technologies: [],
        detectedFramework: null,
    };

    let packageJsonFile: File | null = null;
    let readmeFile: File | null = null;

    // PURE OPTIMIZATION: Use native for loop to avoid Array.from memory allocation
    // Especially important if someone drops a folder with 1M files (e.g. node_modules)
    for (let i = 0; i < files.length; i++) {
        if (signal?.aborted) return result;
        const file = files[i];
        const name = file.name.toLowerCase();

        if (name === 'package.json') {
            packageJsonFile = file;
        } else if (name === 'readme.md') {
            readmeFile = file;
        }

        // Early break if both found
        if (packageJsonFile && readmeFile) break;
    }

    if (!packageJsonFile && !readmeFile) return result;

    if (signal?.aborted) return result;

    // Parallel read: package.json AND README.md simultaneously
    // Optimization: only read if file is small (< 1MB) to prevent browser crash
    const [pkgContent, readmeContent] = await Promise.all([
        (packageJsonFile && packageJsonFile.size < 1024 * 1024) ? packageJsonFile.text() : Promise.resolve(null),
        (!result.description && readmeFile && readmeFile.size < 1024 * 1024) ? readmeFile.text() : Promise.resolve(null),
    ]);

    // Process package.json
    if (pkgContent) {
        try {
            const pkg = JSON.parse(pkgContent);
            if (pkg.name) result.title = pkg.name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            if (pkg.description) result.description = pkg.description;

            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
                if (patterns.some(p => deps[p])) result.technologies.push(tech);
            }
        } catch { /* Invalid JSON */ }
    }

    // Process README (only if no description from package.json)
    if (!result.description && readmeContent) {
        const lines = readmeContent.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('!'));
        if (lines.length) result.description = lines.slice(0, 2).join(' ').substring(0, 200);
    }

    result.technologies = result.technologies.slice(0, 6);
    return result;
}
