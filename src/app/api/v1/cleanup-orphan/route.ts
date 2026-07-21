import { isAdminUser } from '@/lib/security/admin'
import { enforceRouteLimit, getRequestId, jsonSuccess, jsonError, logApiRoute, requireAuthenticatedUser } from '@/app/api/v1/_shared'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)

    const limitResponse = await enforceRouteLimit(request, "api:v1:cleanup:orphan", 10, 60);
    if (limitResponse) {
        logApiRoute(request, {
            requestId,
            action: 'cleanupOrphan.get',
            startedAt,
            status: 429,
            success: false,
            errorCode: 'RATE_LIMITED',
        })
        return limitResponse;
    }

    const auth = await requireAuthenticatedUser()
    const user = auth.user

    if (auth.response || !user) {
        logApiRoute(request, {
            requestId,
            action: 'cleanupOrphan.get',
            startedAt,
            status: 401,
            success: false,
            errorCode: 'UNAUTHORIZED',
        })
        return auth.response ?? jsonError('Not authenticated', 401, 'UNAUTHORIZED')
    }

    if (!isAdminUser(user)) {
        logApiRoute(request, {
            requestId,
            action: 'cleanupOrphan.get',
            startedAt,
            status: 403,
            success: false,
            userId: user?.id ?? null,
            errorCode: 'FORBIDDEN',
        })
        return jsonError('Forbidden', 403, 'FORBIDDEN')
    }

    logApiRoute(request, {
        requestId,
        action: 'cleanupOrphan.get',
        startedAt,
        status: 200,
        success: true,
        userId: user?.id ?? null,
    })
    return jsonSuccess({ message: 'Cleanup endpoint' })
}
