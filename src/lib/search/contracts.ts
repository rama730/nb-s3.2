export type SearchErrorCode =
    | "RATE_LIMITED"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "VALIDATION"
    | "NOT_FOUND"
    | "TRANSIENT";

export class SearchPreviewError extends Error {
    constructor(
        message: string,
        readonly code: SearchErrorCode = "TRANSIENT",
        readonly retryAfterMs?: number,
    ) {
        super(message);
        this.name = "SearchPreviewError";
    }
}

export function isRetryableSearchError(error: unknown) {
    return error instanceof SearchPreviewError && error.code === "TRANSIENT";
}

export function toSearchPreviewError(
    message: string,
    code?: SearchErrorCode,
    retryAfterMs?: number,
) {
    const normalized = message.toLowerCase();
    const inferredCode: SearchErrorCode = code
        ?? (normalized.includes("too many") || normalized.includes("rate limit")
            ? "RATE_LIMITED"
            : normalized.includes("not authenticated")
                ? "UNAUTHENTICATED"
                : normalized.includes("forbidden")
                    ? "FORBIDDEN"
                    : normalized.includes("not found")
                        ? "NOT_FOUND"
                        : "TRANSIENT");
    return new SearchPreviewError(message, inferredCode, retryAfterMs);
}
