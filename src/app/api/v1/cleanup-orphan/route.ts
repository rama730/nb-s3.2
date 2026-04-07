import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/security/admin'
import { getRequestId, jsonSuccess, jsonError, logApiRoute } from '@/app/api/v1/_shared'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

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
