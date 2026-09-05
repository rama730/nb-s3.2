const DISPOSABLE_DOMAINS = new Set([
    'tempmail.com',
    'temp-mail.org',
    '10minutemail.com',
    'guerrillamail.com',
    'guerrillamail.net',
    'guerrillamail.biz',
    'guerrillamail.org',
    'guerrillamailblock.com',
    'sharklasers.com',
    'grr.la',
    'mailinator.com',
    'mailinator.net',
    'yopmail.com',
    'yopmail.net',
    'trashmail.com',
    'trashmail.net',
    'trashmail.me',
    'fakeinbox.com',
    'dispostable.com',
    'generator.email',
    'mohmal.com',
    'inboxkitten.com',
    'getnada.com',
    'throwawaymail.com',
    'burnermail.io',
    'maildrop.cc',
    'minutemail.com',
    'tempinbox.com',
    'crazymailing.com',
    'dropmail.me',
    'tempail.com',
    'emailondeck.com',
    'mytemp.email',
    'fakemailgenerator.com',
    'armyspy.com',
    'cuvox.de',
    'dayrep.com',
    'einrot.com',
    'fleckens.hu',
    'gustr.com',
    'jourrapide.com',
    'rhyta.com',
    'superrito.com',
    'teleworm.us',
    'tempmailaddress.com',
    'nada.ltd',
    'nada.email',
    'trashcanmail.com',
    'trashinbox.com',
    'instantemailaddress.com',
]);

/**
 * Extracts and normalizes the domain part of an email address.
 */
export function extractEmailDomain(email: string): string {
    const trimmed = (email || '').trim().toLowerCase();
    const atIndex = trimmed.lastIndexOf('@');
    if (atIndex === -1 || atIndex === trimmed.length - 1) {
        return '';
    }
    return trimmed.slice(atIndex + 1);
}

/**
 * Checks whether an email address belongs to a known temporary/disposable mail provider.
 * Runs entirely in-memory in O(1) time with zero external network overhead.
 */
export function isDisposableEmail(email: string): boolean {
    const domain = extractEmailDomain(email);
    if (!domain) return false;

    if (DISPOSABLE_DOMAINS.has(domain)) {
        return true;
    }

    // Check parent domains (e.g. sub.temp-mail.org)
    const parts = domain.split('.');
    if (parts.length > 2) {
        const rootDomain = parts.slice(-2).join('.');
        if (DISPOSABLE_DOMAINS.has(rootDomain)) {
            return true;
        }
    }

    return false;
}
