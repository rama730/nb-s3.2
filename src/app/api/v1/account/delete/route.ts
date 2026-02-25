import { NextResponse } from 'next/server';
import { deleteMyAccount } from '@/app/actions/account';
import { validateCsrf } from '@/lib/security/csrf';

function toStatusCode(error?: string) {
    if (!error) return 500;
    if (error === 'Not authenticated') return 401;
    if (error === 'Confirmation required') return 400;
    if (error.includes('re-authenticate')) return 403;
    return 500;
}

export async function DELETE(request: Request) {
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;
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
            return NextResponse.json(
                { success: false, message: result.error || 'Failed to delete account' },
                { status: toStatusCode(result.error) }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Account delete route error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to delete account' },
            { status: 500 }
        );
    }
}
