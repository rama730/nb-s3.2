import assert from 'node:assert/strict';
import test from 'node:test';

import {
    advancePresenceCircuitState,
    computePresenceReconnectDelayMs,
    INITIAL_PRESENCE_CIRCUIT_STATE,
    isPresenceCircuitOpen,
    PRESENCE_CIRCUIT_BREAK_MS,
} from '@/lib/realtime/presence-health';

test('presence circuit opens after repeated retryable failures and resets on success', () => {
    const first = advancePresenceCircuitState(INITIAL_PRESENCE_CIRCUIT_STATE, {
        type: 'failure',
        nowMs: 1_000,
        retryable: true,
        errorMessage: 'token failed',
    });
    const second = advancePresenceCircuitState(first, {
        type: 'failure',
        nowMs: 2_000,
        retryable: true,
        errorMessage: 'token failed again',
    });
    const third = advancePresenceCircuitState(second, {
        type: 'failure',
        nowMs: 3_000,
        retryable: true,
        errorMessage: 'token failed third time',
    });

    assert.equal(isPresenceCircuitOpen(third, 3_001), true);
    assert.equal(third.openUntilMs, 3_000 + PRESENCE_CIRCUIT_BREAK_MS);

    const reset = advancePresenceCircuitState(third, { type: 'success' });
    assert.deepEqual(reset, INITIAL_PRESENCE_CIRCUIT_STATE);
});

test('presence reconnect delay respects the open circuit cooldown window', () => {
    const delayMs = computePresenceReconnectDelayMs({
        attempt: 0,
        nowMs: 10_000,
        circuitOpenUntilMs: 22_500,
        jitterMs: 0,
    });

    assert.equal(delayMs, 12_500);
});
