const NAMED_HTML_ENTITIES: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
};

function decodeHtmlEntities(value: string) {
    return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
        const normalized = token.toLowerCase();
        if (normalized.startsWith('#x')) {
            const codePoint = Number.parseInt(normalized.slice(2), 16);
            return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
        }
        if (normalized.startsWith('#')) {
            const codePoint = Number.parseInt(normalized.slice(1), 10);
            return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
        }
        return NAMED_HTML_ENTITIES[normalized] ?? entity;
    });
}

/**
 * Converts provider metadata into a compact destination name suitable for a
 * project-link row. Provider chrome is removed only when it is a known suffix;
 * the actual resource/profile title is otherwise preserved verbatim.
 */
export function normalizeLinkDestinationTitle(
    value: unknown,
    platform?: string | null,
): string | null {
    if (typeof value !== 'string') return null;
    let title = decodeHtmlEntities(value)
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (platform === 'youtube') title = title.replace(/\s*[-|]\s*YouTube\s*$/i, '').trim();
    if (platform === 'google-scholar') title = title.replace(/\s*[-|]\s*Google Scholar\s*$/i, '').trim();

    return title ? title.slice(0, 160) : null;
}
