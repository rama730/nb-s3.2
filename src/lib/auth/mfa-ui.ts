type AuthLikeError = {
    message?: string | null;
    code?: string | null;
    name?: string | null;
};

function normalizeAuthMessage(value: string | null | undefined): string {
    return typeof value === "string" ? value.trim() : "";
}

function isSvgMarkup(value: string): boolean {
    return value.startsWith("<svg") || value.startsWith("<?xml");
}

export function normalizeTotpQrCodeSource(qrCode: string | null | undefined): string | null {
    const value = normalizeAuthMessage(qrCode);
    if (!value) return null;

    if (value.startsWith("data:image/")) {
        const commaIndex = value.indexOf(",");
        if (commaIndex > -1) {
            const prefix = value.slice(0, commaIndex + 1);
            const payload = value.slice(commaIndex + 1);
            if (isSvgMarkup(payload)) {
                return `${prefix}${encodeURIComponent(payload)}`;
            }

            try {
                if (isSvgMarkup(decodeURIComponent(payload))) {
                    return value;
                }
            } catch {
                // Ignore invalid percent-encoding and fall through to the original value.
            }
        }
        return value;
    }

    if (isSvgMarkup(value)) {
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
    }

    return value;
}

export function getTotpVerificationErrorMessage(error: AuthLikeError | Error | null | undefined): string {
    const code = normalizeAuthMessage((error as AuthLikeError | null | undefined)?.code).toLowerCase();
    const message = normalizeAuthMessage((error as AuthLikeError | null | undefined)?.message);

    if (code === "mfa_totp_verify_failed" || /invalid totp code/i.test(message)) {
        return "That code did not match. Use the current 6-digit code from your authenticator app.";
    }

    if (/expired/i.test(message)) {
        return "That code expired. Wait for the next 6-digit code in your authenticator app and try again.";
    }

    return message || "Failed to verify authenticator app";
}
