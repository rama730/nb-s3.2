import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/security/admin'
import { getRequestId, logApiRequest } from '@/app/api/_shared'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!isAdminUser(user)) {
        logApiRequest(request, {
            requestId,
            action: 'cleanupOrphan.get',
            startedAt,
            status: 403,
            success: false,
            userId: user?.id ?? null,
            errorCode: 'FORBIDDEN',
        })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    logApiRequest(request, {
        requestId,
        action: 'cleanupOrphan.get',
        startedAt,
        status: 200,
        success: true,
        userId: user?.id ?? null,
    })
    return NextResponse.json({ message: 'Cleanup endpoint' })
}
