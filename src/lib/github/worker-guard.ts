import { readdirSync, statSync } from 'fs'

import { sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { appendSafePathSegment } from '@/lib/security/path-safety'

const TENANT_LOCK_NAMESPACE = 'project-git-sync-tenant'

function readPositiveEnv(name: string, fallback: number) {
    const raw = Number(process.env[name] || fallback)
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

export const GITHUB_WORKER_BUDGETS = {
    maxFiles: readPositiveEnv('GITHUB_SYNC_MAX_FILES', 15_000),
    maxBytes: readPositiveEnv('GITHUB_SYNC_MAX_BYTES', 512 * 1024 * 1024),
    maxSingleFileBytes: readPositiveEnv('GITHUB_SYNC_MAX_FILE_BYTES', 10 * 1024 * 1024),
    applyConcurrency: readPositiveEnv('GITHUB_SYNC_APPLY_CONCURRENCY', 8),
}

export async function withTenantSyncLock<T>(tenantId: string | null | undefined, task: () => Promise<T>): Promise<{ skipped: boolean; value: T | null }> {
    if (!tenantId) {
        return {
            skipped: false,
            value: await task(),
        }
    }

    const lockResult = await db.execute<{ locked: boolean }>(sql`
        SELECT pg_try_advisory_lock(
            hashtext(${TENANT_LOCK_NAMESPACE}),
            hashtext(CAST(${tenantId} AS text))
        ) AS locked
    `)
    const lockRow = Array.from(lockResult)[0]
    const lockAcquired = !!lockRow?.locked
    if (!lockAcquired) {
        return { skipped: true, value: null }
    }

    try {
        return {
            skipped: false,
            value: await task(),
        }
    } finally {
        await db.execute(sql`
            SELECT pg_advisory_unlock(
                hashtext(${TENANT_LOCK_NAMESPACE}),
                hashtext(CAST(${tenantId} AS text))
            )
        `)
    }
}

export function assertRepositoryWithinBudgets(rootDir: string, input: { job: string; projectId: string }) {
    let fileCount = 0
    let totalBytes = 0

    const scan = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === '.git') continue

            const fullPath = appendSafePathSegment(dir, entry, 'repository entry')
            const stat = statSync(fullPath)

            if (stat.isDirectory()) {
                scan(fullPath)
                continue
            }

            fileCount += 1
            totalBytes += stat.size

            if (fileCount > GITHUB_WORKER_BUDGETS.maxFiles) {
                throw new Error(
                    `${input.job} rejected for project ${input.projectId}: repository exceeds file budget (${fileCount} > ${GITHUB_WORKER_BUDGETS.maxFiles})`,
                )
            }

            if (stat.size > GITHUB_WORKER_BUDGETS.maxSingleFileBytes) {
                throw new Error(
                    `${input.job} rejected for project ${input.projectId}: file exceeds size budget (${entry})`,
                )
            }

            if (totalBytes > GITHUB_WORKER_BUDGETS.maxBytes) {
                throw new Error(
                    `${input.job} rejected for project ${input.projectId}: repository exceeds byte budget (${totalBytes} > ${GITHUB_WORKER_BUDGETS.maxBytes})`,
                )
            }
        }
    }

    scan(rootDir)

    return {
        fileCount,
        totalBytes,
    }
}

