import { deleteMyAccount } from '@/app/actions/account';
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from '@/app/api/v1/_shared';

function toStatusCode(error?: string) {
    if (!error) return 500;
    if (error === 'Not authenticated') return 401;
    if (error === 'Confirmation required') return 400;
    if (error.includes('re-authenticate')) return 403;
    return 500;
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
    try {
        let confirmationText = '';
        try {
            const body = await request.json();
            if (typeof body?.confirmationText === 'string') {
                confirmationText = body.confirmationText;
            }
        } catch {
            confirmationText = '';
        }

        const result = await deleteMyAccount(confirmationText);
        if (!result.success) {
            const status = toStatusCode(result.error);
            logApiRoute(request, {
                requestId,
                action: 'account.delete',
                startedAt,
                success: false,
                status,
                errorCode:
                    status === 401
                        ? 'UNAUTHORIZED'
                        : status === 400
                            ? 'BAD_REQUEST'
                            : status === 403
                                ? 'FORBIDDEN'
                                : 'INTERNAL_ERROR',
            });
            return jsonError(
                result.error || 'Failed to delete account',
                status,
                status === 401
                    ? 'UNAUTHORIZED'
                    : status === 400
                        ? 'BAD_REQUEST'
                        : status === 403
                            ? 'FORBIDDEN'
                            : 'INTERNAL_ERROR',
            );
        }

        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: true,
            status: 200,
        });
        return jsonSuccess();
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
        return jsonError('Failed to delete account', 500, 'INTERNAL_ERROR');
    }
}
