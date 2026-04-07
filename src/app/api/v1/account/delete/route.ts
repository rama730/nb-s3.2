import { scheduleAccountDeletion } from '@/app/actions/account';
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from '@/app/api/v1/_shared';
import { logger } from '@/lib/logger';
import { validateCsrf } from '@/lib/security/csrf';
import { checkIdempotencyKey, saveIdempotencyResult } from '@/lib/security/idempotency';
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

export async function DELETE(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const idempotencyKey = request.headers.get('idempotency-key') || undefined;

    // CSRF check — uses shared validation utility
    const csrfError = validateCsrf(request);
    if (csrfError) {
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 403,
            errorCode: 'FORBIDDEN',
        });
        return csrfError;
    }

    // Idempotency — prevent duplicate deletion schedules
    const idempotencyCheck = await checkIdempotencyKey(request, 'account.delete');
    if (idempotencyCheck.isDuplicate) {
        if (idempotencyCheck.cachedResponse) {
            logger.info('Account deletion duplicate request returned cached response', {
                module: 'api',
                route: 'account.delete',
                requestId,
                idempotencyKey,
                status: 200,
            });
            logApiRoute(request, {
                requestId,
                action: 'account.delete',
                startedAt,
                success: true,
                status: 200,
            });
            return new Response(idempotencyCheck.cachedResponse, {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        logger.info('Account deletion duplicate request is already in flight', {
            module: 'api',
            route: 'account.delete',
            requestId,
            idempotencyKey,
            status: 409,
        });
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 409,
            errorCode: 'CONFLICT',
        });
        return jsonError('Request is already being processed', 409, 'CONFLICT');
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
        logger.warn('Rate limit check error (non-fatal):', { module: 'api', error: rlErr instanceof Error ? rlErr.message : String(rlErr) });
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
        const successBody = JSON.stringify({
            ok: true,
            data: { deletionId: result.deletionId, hardDeleteAt: result.hardDeleteAt },
        });
        try {
            await saveIdempotencyResult(request, 'account.delete', successBody, idempotencyCheck.lockToken);
        } catch (idempotencyError) {
            logger.warn('Failed to save account deletion idempotency result', {
                module: 'api',
                deletionId: result.deletionId,
                hardDeleteAt: result.hardDeleteAt,
                error: idempotencyError instanceof Error ? idempotencyError.message : String(idempotencyError),
            });
        }
        return jsonSuccess({
            deletionId: result.deletionId,
            hardDeleteAt: result.hardDeleteAt,
        });
    } catch (error) {
        logger.error('Account delete route error:', { module: 'api', error: error instanceof Error ? error.message : String(error) });
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
