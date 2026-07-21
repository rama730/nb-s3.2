export const MAX_DETECTED_REPOSITORY_SKILLS = 24

type PackageDocument = {
    dependencies?: Record<string, unknown>
    devDependencies?: Record<string, unknown>
    peerDependencies?: Record<string, unknown>
    optionalDependencies?: Record<string, unknown>
}

type DependencySignal = {
    skill: string
    packages: readonly string[]
}

// Ordered by how strongly a dependency identifies the project's primary stack.
// Every emitted label is a canonical market-catalog name.
export const REPOSITORY_DEPENDENCY_SIGNALS: readonly DependencySignal[] = [
    { skill: 'Next.js', packages: ['next'] },
    { skill: 'Nuxt', packages: ['nuxt'] },
    { skill: 'Angular', packages: ['@angular/core'] },
    { skill: 'SvelteKit', packages: ['@sveltejs/kit'] },
    { skill: 'Svelte', packages: ['svelte'] },
    { skill: 'Vue.js', packages: ['vue'] },
    { skill: 'React', packages: ['react', 'react-dom'] },
    { skill: 'Astro', packages: ['astro'] },
    { skill: 'Remix', packages: ['@remix-run/react', '@remix-run/node'] },
    { skill: 'SolidJS', packages: ['solid-js'] },
    { skill: 'Qwik', packages: ['@builder.io/qwik'] },
    { skill: 'Preact', packages: ['preact'] },
    { skill: 'React Native', packages: ['react-native'] },
    { skill: 'Expo', packages: ['expo'] },
    { skill: 'Electron', packages: ['electron'] },
    { skill: 'Tauri', packages: ['@tauri-apps/api', '@tauri-apps/cli'] },
    { skill: 'Chrome Extension API', packages: ['@types/chrome', 'chrome-types'] },
    { skill: 'WebExtensions API', packages: ['webextension-polyfill', '@types/webextension-polyfill'] },
    { skill: 'NestJS', packages: ['@nestjs/core'] },
    { skill: 'Fastify', packages: ['fastify'] },
    { skill: 'Express', packages: ['express'] },
    { skill: 'Hono', packages: ['hono'] },
    { skill: 'Koa', packages: ['koa'] },
    { skill: 'AdonisJS', packages: ['@adonisjs/core'] },
    { skill: 'TypeScript', packages: ['typescript'] },
    { skill: 'Tailwind CSS', packages: ['tailwindcss'] },
    { skill: 'Material UI', packages: ['@mui/material'] },
    { skill: 'Chakra UI', packages: ['@chakra-ui/react'] },
    { skill: 'Ant Design', packages: ['antd'] },
    { skill: 'shadcn/ui', packages: ['shadcn', 'shadcn-ui'] },
    { skill: 'Redux', packages: ['redux', '@reduxjs/toolkit'] },
    { skill: 'Zustand', packages: ['zustand'] },
    { skill: 'TanStack Query', packages: ['@tanstack/react-query', '@tanstack/vue-query'] },
    { skill: 'Storybook', packages: ['storybook', '@storybook/react', '@storybook/vue3'] },
    { skill: 'Three.js', packages: ['three'] },
    { skill: 'D3.js', packages: ['d3'] },
    { skill: 'Prisma', packages: ['prisma', '@prisma/client'] },
    { skill: 'Drizzle ORM', packages: ['drizzle-orm', 'drizzle-kit'] },
    { skill: 'PostgreSQL', packages: ['pg', 'postgres'] },
    { skill: 'MongoDB', packages: ['mongodb', 'mongoose'] },
    { skill: 'Redis', packages: ['redis', 'ioredis'] },
    { skill: 'SQLite', packages: ['better-sqlite3', 'sqlite3'] },
    { skill: 'GraphQL', packages: ['graphql', '@apollo/server', '@apollo/client'] },
    { skill: 'tRPC', packages: ['@trpc/server', '@trpc/client'] },
    { skill: 'Supabase', packages: ['@supabase/supabase-js', '@supabase/ssr'] },
    { skill: 'Firebase', packages: ['firebase', 'firebase-admin'] },
    { skill: 'AWS SDK', packages: ['aws-sdk', '@aws-sdk/client-s3', '@aws-sdk/client-dynamodb'] },
    { skill: 'Azure SDK', packages: ['@azure/identity', '@azure/storage-blob'] },
    { skill: 'Google Cloud SDK', packages: ['@google-cloud/storage', '@google-cloud/firestore'] },
    { skill: 'OpenAI API', packages: ['openai'] },
    { skill: 'Anthropic API', packages: ['@anthropic-ai/sdk'] },
    { skill: 'Google Gemini API', packages: ['@google/generative-ai', '@google/genai'] },
    { skill: 'LangChain', packages: ['langchain', '@langchain/core'] },
    { skill: 'LlamaIndex', packages: ['llamaindex'] },
    { skill: 'Vite', packages: ['vite'] },
    { skill: 'Webpack', packages: ['webpack'] },
    { skill: 'Turborepo', packages: ['turbo'] },
    { skill: 'Nx', packages: ['nx', '@nx/devkit'] },
    { skill: 'Playwright', packages: ['playwright', '@playwright/test'] },
    { skill: 'Cypress', packages: ['cypress'] },
    { skill: 'Jest', packages: ['jest'] },
    { skill: 'Vitest', packages: ['vitest'] },
    { skill: 'Puppeteer', packages: ['puppeteer', 'puppeteer-core'] },
] as const

const FRAMEWORK_PRIORITY = [
    'Next.js', 'Nuxt', 'Angular', 'SvelteKit', 'Svelte', 'Vue.js', 'React', 'Astro',
    'Remix', 'SolidJS', 'Qwik', 'NestJS', 'Fastify', 'Express', 'Hono', 'Koa',
] as const

function dependencyNames(document: PackageDocument): Set<string> {
    return new Set([
        ...Object.keys(document.dependencies ?? {}),
        ...Object.keys(document.devDependencies ?? {}),
        ...Object.keys(document.peerDependencies ?? {}),
        ...Object.keys(document.optionalDependencies ?? {}),
    ])
}

export function detectPackageTechnologies(
    document: PackageDocument | null | undefined,
    limit = MAX_DETECTED_REPOSITORY_SKILLS,
): { technologies: string[]; detectedFramework: string | null } {
    if (!document || typeof document !== 'object') return { technologies: [], detectedFramework: null }
    const dependencies = dependencyNames(document)
    const technologies = REPOSITORY_DEPENDENCY_SIGNALS
        .filter((signal) => signal.packages.some((packageName) => dependencies.has(packageName)))
        .map((signal) => signal.skill)
    const unique = [...new Set(technologies)].slice(0, Math.max(1, limit))
    return {
        technologies: unique,
        detectedFramework: FRAMEWORK_PRIORITY.find((framework) => unique.includes(framework)) ?? null,
    }
}

export function detectRepositoryFileTechnologies(
    paths: readonly string[],
    limit = MAX_DETECTED_REPOSITORY_SKILLS,
): string[] {
    const normalized = paths.map((path) => path.replaceAll('\\', '/').toLocaleLowerCase('en-US'))
    const has = (predicate: (path: string) => boolean) => normalized.some(predicate)
    const detected: string[] = []
    const add = (...skills: string[]) => detected.push(...skills)

    if (has((path) => path === 'dockerfile' || path.endsWith('/dockerfile') || /(^|\/)dockerfile\.[^/]+$/.test(path))) add('Docker')
    if (has((path) => /(^|\/)(compose|docker-compose)\.(ya?ml)$/.test(path))) add('Docker Compose', 'Docker')
    if (has((path) => path.includes('/.github/') || path.startsWith('.github/'))) add('GitHub')
    if (has((path) => path.includes('.github/workflows/'))) add('GitHub Actions')
    if (has((path) => path.endsWith('.gitlab-ci.yml'))) add('GitLab CI/CD', 'GitLab')
    if (has((path) => path.endsWith('azure-pipelines.yml') || path.endsWith('azure-pipelines.yaml'))) add('Azure DevOps')
    if (has((path) => path.endsWith('jenkinsfile'))) add('Jenkins')
    if (has((path) => path.includes('/.circleci/') || path.startsWith('.circleci/'))) add('CircleCI')
    if (has((path) => path.endsWith('.tf') || path.endsWith('.tf.json'))) add('Terraform')
    if (has((path) => path.endsWith('vercel.json'))) add('Vercel')
    if (has((path) => path.endsWith('netlify.toml'))) add('Netlify')
    if (has((path) => path.endsWith('pnpm-lock.yaml'))) add('pnpm')
    if (has((path) => path.endsWith('yarn.lock'))) add('Yarn')
    if (has((path) => path.endsWith('bun.lock') || path.endsWith('bun.lockb'))) add('Bun')
    if (has((path) => path.endsWith('package-lock.json'))) add('npm')
    if (has((path) => path.endsWith('cargo.toml'))) add('Rust', 'Cargo')
    if (has((path) => path.endsWith('pyproject.toml'))) add('Python')
    if (has((path) => path.endsWith('go.mod'))) add('Go')
    if (has((path) => path.endsWith('pom.xml'))) add('Java', 'Maven')
    if (has((path) => path.endsWith('build.gradle') || path.endsWith('build.gradle.kts'))) add('Gradle')

    return [...new Set(detected)].slice(0, Math.max(1, limit))
}

export function mergeDetectedTechnologies(...groups: readonly (readonly string[])[]): string[] {
    return [...new Set(groups.flat())].slice(0, MAX_DETECTED_REPOSITORY_SKILLS)
}
