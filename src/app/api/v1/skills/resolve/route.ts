import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope'
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared'
import { normalizeSkillInputList } from '@/lib/skills/normalization'
import { summarizeSkillLabels } from '@/lib/skills/service'
import { SKILL_CATALOG_VERSION } from '@/lib/skills/catalog'

export async function POST(request: Request) {
    const limited = await enforceRouteLimit(request, 'skills:resolve', 60, 60)
    if (limited) return limited
    const auth = await requireAuthenticatedUser()
    if (auth.response) return auth.response
    if (!auth.user) return jsonError('Not authenticated', 401, 'UNAUTHORIZED')

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return jsonError('Invalid JSON body', 400, 'BAD_REQUEST')
    }
    const labels = typeof body === 'object' && body && Array.isArray((body as { labels?: unknown }).labels)
        ? (body as { labels: unknown[] }).labels.filter((label): label is string => typeof label === 'string')
        : null
    if (!labels) return jsonError('labels must be an array of strings', 400, 'BAD_REQUEST')

    const normalized = normalizeSkillInputList(labels)
    return jsonSuccess({ skills: summarizeSkillLabels(normalized), catalogVersion: SKILL_CATALOG_VERSION })
}
