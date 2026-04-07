import { createClient } from '@/lib/supabase/server'
import { checkUsernameAvailabilityWithClient } from '@/lib/onboarding/username-check'
import { validateCsrf } from '@/lib/security/csrf'
import { getRequestId, jsonSuccess, jsonError, logApiRoute } from '@/app/api/v1/_shared'

async function runUsernameCheck(username: string, request: Request) {
    const supabase = await createClient()
    const forwardedFor = request.headers.get('x-forwarded-for') || ''
    const ipAddress = forwardedFor.split(',')[0]?.trim() || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const { data: authData } = await supabase.auth.getUser()

    const user = authData.user || null
    const viewerKey = user?.id || `anon:${ipAddress}`
    return checkUsernameAvailabilityWithClient({
        supabase,
        username,
        viewerKey,
        viewerId: user?.id || null,
        ipAddress,
        userAgent,
    })
}

function resolveStatus(result: Awaited<ReturnType<typeof runUsernameCheck>>) {
    if (result.rateLimited) return 429
    if (result.code === 'DB_ERROR') return 503
    if (result.code === 'USERNAME_INVALID') return 400
    return 200
}

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const url = new URL(request.url)
    const username = url.searchParams.get('username') || ''
    const result = await runUsernameCheck(username, request)
    const status = resolveStatus(result)
    logApiRoute(request, {
        requestId,
        action: 'onboarding.usernameCheck.get',
        startedAt,
        status,
        success: status < 400,
        errorCode:
            status === 429
                ? 'RATE_LIMITED'
                : status === 400
                    ? 'BAD_REQUEST'
                    : status === 503
                        ? 'DB_ERROR'
                        : undefined,
    })
    if (status >= 400) {
        const errorCode = status === 429 ? 'RATE_LIMITED' : status === 400 ? 'BAD_REQUEST' : 'DB_ERROR'
        return jsonError(result.message || errorCode, status, errorCode)
    }
    return jsonSuccess(result)
}

export async function POST(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const csrfError = validateCsrf(request)
    if (csrfError) {
        logApiRoute(request, {
            requestId,
            action: 'onboarding.usernameCheck.post',
            startedAt,
            status: 403,
            success: false,
            errorCode: 'FORBIDDEN',
        })
        return csrfError
    }

    let body: { username?: string } = {}
    try {
        body = (await request.json()) as { username?: string }
    } catch {
        body = {}
    }

    const result = await runUsernameCheck(body.username || '', request)
    const status = resolveStatus(result)
    logApiRoute(request, {
        requestId,
        action: 'onboarding.usernameCheck.post',
        startedAt,
        status,
        success: status < 400,
        errorCode:
            status === 429
                ? 'RATE_LIMITED'
                : status === 400
                    ? 'BAD_REQUEST'
                    : status === 503
                        ? 'DB_ERROR'
                        : undefined,
    })
    if (status >= 400) {
        const errorCode = status === 429 ? 'RATE_LIMITED' : status === 400 ? 'BAD_REQUEST' : 'DB_ERROR'
        return jsonError(result.message || errorCode, status, errorCode)
    }
    return jsonSuccess(result)
}
