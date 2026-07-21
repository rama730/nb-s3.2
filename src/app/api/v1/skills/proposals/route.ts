import { and, desc, eq } from 'drizzle-orm'
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope'
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared'
import { db } from '@/lib/db'
import { skillProposals } from '@/lib/db/schema'
import { normalizeSkillInputList } from '@/lib/skills/normalization'
import { resolveSkillsForWrite } from '@/lib/skills/service'
import { logger } from '@/lib/logger'

export async function GET(request: Request) {
    const limited = await enforceRouteLimit(request, 'skills:proposals:read', 30, 60)
    if (limited) return limited
    const auth = await requireAuthenticatedUser()
    if (auth.response) return auth.response
    if (!auth.user) return jsonError('Not authenticated', 401, 'UNAUTHORIZED')
    const userId = auth.user.id

    const proposals = await db
        .select({
            id: skillProposals.id,
            label: skillProposals.label,
            status: skillProposals.status,
            resolvedSkillId: skillProposals.resolvedSkillId,
            createdAt: skillProposals.createdAt,
            updatedAt: skillProposals.updatedAt,
        })
        .from(skillProposals)
        .where(eq(skillProposals.submittedBy, userId))
        .orderBy(desc(skillProposals.createdAt))
        .limit(100)

    return jsonSuccess({ proposals })
}

export async function POST(request: Request) {
    const limited = await enforceRouteLimit(request, 'skills:proposals:create', 10, 60)
    if (limited) return limited
    const auth = await requireAuthenticatedUser()
    if (auth.response) return auth.response
    if (!auth.user) return jsonError('Not authenticated', 401, 'UNAUTHORIZED')
    const userId = auth.user.id

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return jsonError('Invalid JSON body', 400, 'BAD_REQUEST')
    }
    const label = typeof body === 'object' && body && typeof (body as { label?: unknown }).label === 'string'
        ? (body as { label: string }).label
        : ''
    const [normalized] = normalizeSkillInputList([label], 1)
    if (!normalized) return jsonError('A valid skill label is required', 400, 'BAD_REQUEST')

    const [skill] = await db.transaction((tx) => resolveSkillsForWrite(tx, [normalized], userId))
    if (!skill) return jsonError('Unable to submit skill', 500, 'INTERNAL_ERROR')

    const [proposal] = await db
        .select({ id: skillProposals.id, label: skillProposals.label, status: skillProposals.status })
        .from(skillProposals)
        .where(and(eq(skillProposals.submittedBy, userId), eq(skillProposals.resolvedSkillId, skill.id)))
        .limit(1)

    logger.metric('skills.proposal.submitted', {
        userId,
        status: proposal?.status ?? skill.status,
        version: 'custom',
        count: 1,
    })

    return jsonSuccess({ skill, proposal: proposal ?? null }, 'Skill submitted for catalog review', { status: 201 })
}
