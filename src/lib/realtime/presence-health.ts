export interface PresenceCircuitState {
    failureCount: number;
    lastFailureAtMs: number | null;
    openUntilMs: number | null;
    lastError: string | null;
}

export const PRESENCE_FAILURE_RESET_WINDOW_MS = 30_000;
export const PRESENCE_CIRCUIT_FAILURE_THRESHOLD = 3;
export const PRESENCE_CIRCUIT_BREAK_MS = 15_000;

export const INITIAL_PRESENCE_CIRCUIT_STATE: PresenceCircuitState = {
    failureCount: 0,
    lastFailureAtMs: null,
    openUntilMs: null,
    lastError: null,
};

export function isPresenceCircuitOpen(
    state: PresenceCircuitState,
    nowMs: number = Date.now(),
) {
    return typeof state.openUntilMs === 'number' && state.openUntilMs > nowMs;
}

export function advancePresenceCircuitState(
    state: PresenceCircuitState,
    event:
        | { type: 'success' }
        | {
            type: 'failure';
            nowMs: number;
            retryable: boolean;
            errorMessage: string | null;
        },
): PresenceCircuitState {
    if (event.type === 'success') {
        return { ...INITIAL_PRESENCE_CIRCUIT_STATE };
    }

    if (!event.retryable) {
        return {
            failureCount: 0,
            lastFailureAtMs: event.nowMs,
            openUntilMs: null,
            lastError: event.errorMessage,
        };
    }

    const withinWindow = state.lastFailureAtMs !== null
        && event.nowMs - state.lastFailureAtMs <= PRESENCE_FAILURE_RESET_WINDOW_MS;
    const failureCount = withinWindow ? state.failureCount + 1 : 1;
    const openUntilMs = failureCount >= PRESENCE_CIRCUIT_FAILURE_THRESHOLD
        ? Math.max(state.openUntilMs ?? 0, event.nowMs + PRESENCE_CIRCUIT_BREAK_MS)
        : state.openUntilMs;

    return {
        failureCount,
        lastFailureAtMs: event.nowMs,
        openUntilMs,
        lastError: event.errorMessage,
    };
}

export function computePresenceReconnectDelayMs(params: {
    attempt: number;
    nowMs: number;
    circuitOpenUntilMs?: number | null;
    jitterMs?: number;
}) {
    const baseDelayMs = Math.min(10_000, 800 * Math.max(1, params.attempt + 1));
    const circuitDelayMs = params.circuitOpenUntilMs && params.circuitOpenUntilMs > params.nowMs
        ? params.circuitOpenUntilMs - params.nowMs
        : 0;
    return Math.max(baseDelayMs + (params.jitterMs ?? 0), circuitDelayMs);
}
