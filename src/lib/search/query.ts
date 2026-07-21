export const MAX_GLOBAL_SEARCH_LENGTH = 100;
export const MAX_GLOBAL_SEARCH_TOKENS = 8;

export function normalizeSearchQuery(value: string | null | undefined, maxLength = MAX_GLOBAL_SEARCH_LENGTH) {
    return (value ?? "")
        .normalize("NFKC")
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, maxLength);
}

export function tokenizeSearchQuery(value: string, maxTokens = MAX_GLOBAL_SEARCH_TOKENS) {
    return normalizeSearchQuery(value)
        .split(" ")
        .filter(Boolean)
        .slice(0, maxTokens);
}

export function escapeLikePattern(value: string) {
    return value.replace(/[\\%_]/g, "\\$&");
}

export function containsLikePattern(value: string) {
    return `%${escapeLikePattern(value)}%`;
}
