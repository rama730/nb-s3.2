import { scheduleAccountDeletion } from '@/app/actions/account';
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from '@/app/api/v1/_shared';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createClient } from '@/lib/supabase/server';

function toStatusCode(error?: string) {
    if (!error) return 500;
    if (error === 'Not authenticated') return 401;
    if (error === 'Confirmation required') return 400;
    if (error.includes('re-authenticate')) return 403;
    if (error.includes('already scheduled')) return 409;
    return 500;
}

function toErrorCode(status: number) {
    switch (status) {
        case 401: return 'UNAUTHORIZED';
        case 400: return 'BAD_REQUEST';
        case 403: return 'FORBIDDEN';
        case 409: return 'CONFLICT';
        case 429: return 'RATE_LIMITED';
        default: return 'INTERNAL_ERROR';
    }
}

function getCsrfError(request: Request): string | null {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (!origin || !host) return 'Missing origin or host header';
    try {
        const originHost = new URL(origin).host;
        if (originHost !== host) return 'Origin mismatch';
    } catch {
        return 'Invalid origin';
    }
    return null;
}

export async function DELETE(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);

    // CSRF check
    const csrfError = getCsrfError(request);
    if (csrfError) {
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 403,
            errorCode: 'FORBIDDEN',
        });
        return jsonError(csrfError, 403, 'FORBIDDEN');
    }

    // Rate limiting: 3 attempts per hour
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const rateLimitResult = await consumeRateLimit(
                `account-delete:${user.id}`,
                3,
                3600,
            );
            if (!rateLimitResult.allowed) {
                logApiRoute(request, {
                    requestId,
                    action: 'account.delete',
                    startedAt,
                    success: false,
                    status: 429,
                    errorCode: 'RATE_LIMITED',
                });
                return jsonError(
                    'Too many deletion attempts. Please try again later.',
                    429,
                    'RATE_LIMITED',
                );
            }
        }
    } catch (rlErr) {
        // Rate limit check failure is non-blocking
        console.error('Rate limit check error (non-fatal):', rlErr);
    }

    try {
        let confirmationText = '';
        let reason: string | undefined;
        try {
            const body = await request.json();
            if (typeof body?.confirmationText === 'string') {
                confirmationText = body.confirmationText;
            }
            if (typeof body?.reason === 'string') {
                reason = body.reason;
            }
        } catch {
            confirmationText = '';
        }

        const result = await scheduleAccountDeletion(confirmationText, reason);
        if (!result.success) {
            const status = toStatusCode(result.error);
            const errorCode = toErrorCode(status);
            logApiRoute(request, {
                requestId,
                action: 'account.delete',
                startedAt,
                success: false,
                status,
                errorCode,
            });
            return jsonError(
                result.error || 'Failed to schedule account deletion',
                status,
                errorCode,
            );
        }

        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: true,
            status: 200,
        });
        return jsonSuccess({
            deletionId: result.deletionId,
            hardDeleteAt: result.hardDeleteAt,
        });
    } catch (error) {
        console.error('Account delete route error:', error);
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 500,
            errorCode: 'INTERNAL_ERROR',
        });
        return jsonError('Failed to schedule account deletion', 500, 'INTERNAL_ERROR');
    }
}
