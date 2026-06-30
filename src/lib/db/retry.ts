import { logger } from "@/lib/logger";

const DEFAULT_DB_RETRY_DELAYS_MS = [150, 450] as const;

const TRANSIENT_DB_ERROR_CODES = new Set([
    "08000",
    "08003",
    "08006",
    "53300",
    "53400",
    "57P01",
    "57P02",
    "57P03",
    "EAI_AGAIN",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
]);

const TRANSIENT_DB_MESSAGE_PATTERNS = [
    /connection\s+terminated/i,
    /connection\s+timeout/i,
    /connect\s+timeout/i,
    /connection\s+reset/i,
    /read\s+econnreset/i,
    /socket\s+hang\s+up/i,
    /server\s+closed\s+the\s+connection/i,
    /terminating\s+connection/i,
    /getaddrinfo/i,
    /network\s+is\s+unreachable/i,
];

type DbRetryOptions = {
    delaysMs?: readonly number[];
    module?: string;
};

function sleep(delayMs: number) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function readDbErrorCode(error: unknown, depth = 0): string | null {
    if (!error || typeof error !== "object" || depth > 4) return null;
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    return readDbErrorCode((error as { cause?: unknown }).cause, depth + 1);
}

export function isTransientDbError(error: unknown, depth = 0): boolean {
    if (!error || typeof error !== "object" || depth > 4) return false;

    const code = readDbErrorCode(error);
    if (code && TRANSIENT_DB_ERROR_CODES.has(code)) return true;

    const message = error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown }).message === "string"
            ? String((error as { message: unknown }).message)
            : "";
    if (message && TRANSIENT_DB_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
        return true;
    }

    return isTransientDbError((error as { cause?: unknown }).cause, depth + 1);
}

export async function withDbRetry<T>(
    action: string,
    run: () => Promise<T>,
    options: DbRetryOptions = {},
): Promise<T> {
    const delaysMs = options.delaysMs ?? DEFAULT_DB_RETRY_DELAYS_MS;
    let attempt = 0;
    let lastError: unknown;

    for (;;) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            if (!isTransientDbError(error) || attempt >= delaysMs.length) {
                throw error;
            }

            logger.warn("db.transient_retry", {
                module: options.module ?? "db",
                action,
                attempt: attempt + 1,
                errorCode: readDbErrorCode(error),
                error: error instanceof Error ? error.message : String(error),
            });

            await sleep(delaysMs[attempt] ?? 0);
            attempt += 1;
        }
    }

    throw lastError;
}
