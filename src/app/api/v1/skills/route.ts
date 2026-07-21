import { createHash } from 'node:crypto'
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope'
import { enforceRouteLimit } from '@/app/api/v1/_shared'
import { SKILL_KINDS, type SkillKind, type SkillMarketTier } from '@/lib/skills/types'
import { searchSkillCatalog } from '@/lib/skills/service'
import { SKILL_CATALOG_VERSION } from '@/lib/skills/catalog'
import { logger } from '@/lib/logger'

const TIERS = new Set<SkillMarketTier>(['core', 'extended', 'reference'])
const KINDS = new Set<SkillKind>(SKILL_KINDS)

export async function GET(request: Request) {
    const startedAt = performance.now()
    const limited = await enforceRouteLimit(request, 'skills:search', 120, 60, 'publicRead')
    if (limited) return limited

    const url = new URL(request.url)
    const query = url.searchParams.get('q')?.trim().slice(0, 80) ?? ''
    const category = url.searchParams.get('category')?.trim().slice(0, 60) || null
    const kindValue = url.searchParams.get('kind')?.trim() as SkillKind | undefined
    const tierValue = url.searchParams.get('tier')?.trim() as SkillMarketTier | undefined
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 30) || 30))

    if (kindValue && !KINDS.has(kindValue)) return jsonError('Invalid skill kind', 400, 'BAD_REQUEST')
    if (tierValue && !TIERS.has(tierValue)) return jsonError('Invalid market tier', 400, 'BAD_REQUEST')

    const skills = await searchSkillCatalog({
        query,
        category,
        kind: kindValue ?? null,
        tier: tierValue ?? null,
        limit,
    })
    logger.metric('skills.catalog.search', {
        durationMs: Math.round(performance.now() - startedAt),
        count: skills.length,
        kind: kindValue ?? 'all',
        version: SKILL_CATALOG_VERSION,
    })

    const etag = createHash('sha256')
        .update(JSON.stringify([SKILL_CATALOG_VERSION, category, kindValue, tierValue, query]))
        .digest('base64url')
        .slice(0, 24)

    return jsonSuccess(
        { skills, catalogVersion: SKILL_CATALOG_VERSION },
        undefined,
        { headers: { 'Cache-Control': query ? 'public, max-age=60, stale-while-revalidate=300' : 'public, max-age=3600, stale-while-revalidate=86400', ETag: `"skills-${etag}"` } },
    )
}
