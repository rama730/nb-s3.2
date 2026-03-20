export function resolveCurrentSessionRowId(
    sessionIds: string[],
    currentSessionId?: string | null,
): string | null {
    if (currentSessionId && sessionIds.includes(currentSessionId)) {
        return currentSessionId;
    }

    if (sessionIds.length === 1) {
        return sessionIds[0] ?? null;
    }

    return null;
}
