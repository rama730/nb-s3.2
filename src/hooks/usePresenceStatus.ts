'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PresenceEntry {
    online: boolean;
    lastSeen: Date | null;
}

const POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 4 * 60_000; // 4 minutes (server debounces to 5 min)

// Simple in-memory presence tracking using heartbeat timestamps
const _presenceMap = new Map<string, PresenceEntry>();

export function usePresenceStatus(userIds: string[]): Map<string, PresenceEntry> {
    const [status, setStatus] = useState<Map<string, PresenceEntry>>(() => new Map());
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const refresh = useCallback(() => {
        const next = new Map<string, PresenceEntry>();
        for (const id of userIds) {
            const entry = _presenceMap.get(id);
            next.set(id, entry ?? { online: false, lastSeen: null });
        }
        setStatus(next);
    }, [userIds]);

    useEffect(() => {
        refresh();
        intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [refresh]);

    return status;
}

export function markUserOnline(userId: string) {
    _presenceMap.set(userId, { online: true, lastSeen: new Date() });
}

export function markUserOffline(userId: string) {
    const entry = _presenceMap.get(userId);
    _presenceMap.set(userId, { online: false, lastSeen: entry?.lastSeen ?? new Date() });
}

// ============================================================================
// Heartbeat — sends periodic presence pings to the server
// ============================================================================

let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _heartbeatActive = false;
let _visibilityChangeHandler: (() => void) | null = null;

function sendHeartbeat() {
    fetch('/api/v1/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
    }).catch(() => {
        // Silent fail — presence is best-effort
    });
}

/**
 * Start sending periodic heartbeats to the server.
 * Call once on app mount. Safe to call multiple times (idempotent).
 */
export function startPresenceHeartbeat() {
    if (_heartbeatActive) return;
    _heartbeatActive = true;

    // Send initial heartbeat
    sendHeartbeat();

    _heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    // Handle visibility changes — pause when hidden, resume when visible
    if (typeof document !== 'undefined' && !_visibilityChangeHandler) {
        _visibilityChangeHandler = () => {
            if (document.hidden) {
                if (_heartbeatInterval) {
                    clearInterval(_heartbeatInterval);
                    _heartbeatInterval = null;
                }
                return;
            }

            if (_heartbeatActive && !_heartbeatInterval) {
                sendHeartbeat();
                _heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
            }
        };
        document.addEventListener('visibilitychange', _visibilityChangeHandler);
    }
}

/**
 * Stop sending heartbeats. Call on app unmount.
 */
export function stopPresenceHeartbeat() {
    _heartbeatActive = false;
    if (_heartbeatInterval) {
        clearInterval(_heartbeatInterval);
        _heartbeatInterval = null;
    }
    if (typeof document !== 'undefined' && _visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', _visibilityChangeHandler);
        _visibilityChangeHandler = null;
    }
}
