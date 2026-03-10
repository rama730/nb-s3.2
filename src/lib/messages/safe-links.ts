export const TRAILING_LINK_PUNCTUATION_REGEX = /[),.;!?]+$/;
const URL_WHITESPACE_REGEX = /\s/;

export function normalizeSafeExternalUrl(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;

    const sanitized = trimmed.replace(TRAILING_LINK_PUNCTUATION_REGEX, '');
    if (!sanitized) return null;
    // Do not treat multiline/sentence text as a URL token.
    if (URL_WHITESPACE_REGEX.test(sanitized)) return null;

    const candidate = /^https?:\/\//i.test(sanitized) ? sanitized : `https://${sanitized}`;
    try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        const hostname = parsed.hostname.toLowerCase();
        if (!hostname || !hostname.includes('.')) return null;
        const tld = hostname.split('.').pop() || '';
        if (tld.length < 2) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

export function parseSafeLinkToken(token: string): { href: string; display: string; trailing: string } | null {
    const raw = token.trim();
    if (!raw) return null;
    const trailing = (raw.match(TRAILING_LINK_PUNCTUATION_REGEX) || [''])[0];
    const core = trailing ? raw.slice(0, -trailing.length) : raw;
    const normalized = normalizeSafeExternalUrl(core);
    if (!normalized) return null;

    return {
        href: normalized,
        display: core,
        trailing,
    };
}
