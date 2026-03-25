import { exportAccountData } from '@/app/actions/account';
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from '@/app/api/v1/_shared';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);

    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            logApiRoute(request, {
                requestId,
                action: 'account.export',
                startedAt,
                success: false,
                status: 401,
                errorCode: 'UNAUTHORIZED',
            });
            return jsonError('Not authenticated', 401, 'UNAUTHORIZED');
        }

        // Rate limit: 1 export per hour
        const rateLimitResult = await consumeRateLimit(
            `account-export:${user.id}`,
            1,
            3600,
        );
        if (!rateLimitResult.allowed) {
            logApiRoute(request, {
                requestId,
                action: 'account.export',
                startedAt,
                success: false,
                status: 429,
                errorCode: 'RATE_LIMITED',
            });
            return jsonError(
                'You can only export your data once per hour. Please try again later.',
                429,
                'RATE_LIMITED',
            );
        }

        const result = await exportAccountData();

        if (!result.success) {
            logApiRoute(request, {
                requestId,
                action: 'account.export',
                startedAt,
                success: false,
                status: 500,
                errorCode: 'INTERNAL_ERROR',
            });
            return jsonError(
                result.error || 'Failed to export account data',
                500,
                'INTERNAL_ERROR',
            );
        }

        logApiRoute(request, {
            requestId,
            action: 'account.export',
            startedAt,
            success: true,
            status: 200,
        });

        // Return as downloadable JSON
        return new Response(JSON.stringify(result.data, null, 2), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="account-data-${new Date().toISOString().slice(0, 10)}.json"`,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    } catch (error) {
        console.error('Account export route error:', error);
        logApiRoute(request, {
            requestId,
            action: 'account.export',
            startedAt,
            success: false,
            status: 500,
            errorCode: 'INTERNAL_ERROR',
        });
        return jsonError('Failed to export account data', 500, 'INTERNAL_ERROR');
    }
}
