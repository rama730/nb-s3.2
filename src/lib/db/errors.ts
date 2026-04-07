export function isMissingRelationError(error: unknown, relationName: string) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(`relation "${relationName}" does not exist`)) {
        return true;
    }

    const cause = typeof error === "object" && error !== null && "cause" in error
        ? (error as { cause?: unknown }).cause
        : undefined;
    const code = typeof cause === "object" && cause !== null && "code" in cause
        ? (cause as { code?: unknown }).code
        : undefined;

    return code === "42P01";
}
