import { db } from '@/lib/db'
import { reservedUsernames } from '@/lib/db/schema'
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from '@/app/api/v1/_shared'
import { logger } from '@/lib/logger'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { isAdminUser } from '@/lib/security/admin'
import { validateCsrf } from '@/lib/security/csrf'
import { createClient } from '@/lib/supabase/server'
import { CORE_RESERVED_USERNAMES, normalizeUsername } from '@/lib/validations/username'
import { asc, eq } from 'drizzle-orm'

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
const CORE_RESERVED_SET = new Set<string>(CORE_RESERVED_USERNAMES)

async function requireAdmin() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()
    const user = authData.user
    if (!user) return { ok: false as const, status: 401 as const, errorCode: 'UNAUTHORIZED' as const, message: 'Not authenticated' }
    if (!isAdminUser(user)) return { ok: false as const, status: 403 as const, errorCode: 'FORBIDDEN' as const, message: 'Forbidden' }
    return { ok: true as const, user }
}

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const admin = await requireAdmin()
    if (!admin.ok) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.get',
            startedAt,
            success: false,
            status: admin.status,
            errorCode: admin.errorCode,
        })
        return jsonError(admin.message, admin.status, admin.errorCode)
    }

    // H10: Rate limit admin endpoints to prevent abuse from compromised admin accounts
    const rate = await consumeRateLimit(`admin-reserved-usernames:${admin.user.id}`, 30, 60)
    if (!rate.allowed) {
        return jsonError('Rate limit exceeded', 429, 'RATE_LIMITED')
    }

    const rows = await db
        .select({
            username: reservedUsernames.username,
            reason: reservedUsernames.reason,
            createdAt: reservedUsernames.createdAt,
        })
        .from(reservedUsernames)
        .orderBy(asc(reservedUsernames.username))

    logApiRoute(request, {
        requestId,
        action: 'account.reservedUsernames.get',
        userId: admin.user.id,
        startedAt,
        success: true,
        status: 200,
    })
    return jsonSuccess({ items: rows })
}

export async function POST(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const csrfError = validateCsrf(request)
    if (csrfError) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.post',
            startedAt,
            success: false,
            status: 403,
            errorCode: 'FORBIDDEN',
        })
        return csrfError
    }

    const admin = await requireAdmin()
    if (!admin.ok) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.post',
            startedAt,
            success: false,
            status: admin.status,
            errorCode: admin.errorCode,
        })
        return jsonError(admin.message, admin.status, admin.errorCode)
    }

    let body: { username?: string; reason?: string }
    try {
        body = (await request.json()) as { username?: string; reason?: string }
    } catch {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.post',
            userId: admin.user.id,
            startedAt,
            success: false,
            status: 400,
            errorCode: 'BAD_REQUEST',
        })
        return jsonError('Malformed JSON', 400, 'BAD_REQUEST')
    }

    const username = normalizeUsername(body.username || '')
    if (!USERNAME_PATTERN.test(username)) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.post',
            userId: admin.user.id,
            startedAt,
            success: false,
            status: 400,
            errorCode: 'BAD_REQUEST',
        })
        return jsonError(
            'Username must be 3-20 chars with lowercase letters, numbers, or underscores',
            400,
            'BAD_REQUEST'
        )
    }

    const reason = (body.reason || '').trim().slice(0, 120) || 'admin'

    await db
        .insert(reservedUsernames)
        .values({ username, reason })
        .onConflictDoUpdate({
            target: reservedUsernames.username,
            set: { reason },
        })

    logApiRoute(request, {
        requestId,
        action: 'account.reservedUsernames.post',
        userId: admin.user.id,
        startedAt,
        success: true,
        status: 200,
    })
    return jsonSuccess()
}

export async function DELETE(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const csrfError = validateCsrf(request)
    if (csrfError) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            startedAt,
            success: false,
            status: 403,
            errorCode: 'FORBIDDEN',
        })
        return csrfError
    }

    const admin = await requireAdmin()
    if (!admin.ok) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            startedAt,
            success: false,
            status: admin.status,
            errorCode: admin.errorCode,
        })
        return jsonError(admin.message, admin.status, admin.errorCode)
    }

    let body: { username?: string }
    try {
        body = (await request.json()) as { username?: string }
    } catch {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            userId: admin.user.id,
            startedAt,
            success: false,
            status: 400,
            errorCode: 'BAD_REQUEST',
        })
        return jsonError('Malformed JSON', 400, 'BAD_REQUEST')
    }

    const username = normalizeUsername(body.username || '')
    if (!username) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            userId: admin.user.id,
            startedAt,
            success: false,
            status: 400,
            errorCode: 'BAD_REQUEST',
        })
        return jsonError('Username is required', 400, 'BAD_REQUEST')
    }
    if (CORE_RESERVED_SET.has(username)) {
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            userId: admin.user.id,
            startedAt,
            success: false,
            status: 400,
            errorCode: 'BAD_REQUEST',
        })
        return jsonError('Core reserved usernames cannot be removed', 400, 'BAD_REQUEST')
    }

    try {
        await db.delete(reservedUsernames).where(eq(reservedUsernames.username, username))
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            userId: admin.user.id,
            startedAt,
            success: true,
            status: 200,
        })
        return jsonSuccess()
    } catch (error) {
        logger.error('[account.reservedUsernames.delete] delete failed', {
            module: 'api',
            requestId,
            userId: admin.user.id,
            username,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
        })
        logApiRoute(request, {
            requestId,
            action: 'account.reservedUsernames.delete',
            userId: admin.user.id,
            startedAt,
            success: false,
            status: 500,
            errorCode: 'INTERNAL_ERROR',
        })
        return jsonError('Failed to delete reserved username', 500, 'INTERNAL_ERROR')
    }
}
