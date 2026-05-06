'use client';

import { useEffect, useRef, useState } from 'react';

export const UNREAD_CLEAR_ANIMATION_MS = 220;

export interface SmoothUnreadCountState {
    count: number;
    clearing: boolean;
}

function normalizeUnreadCount(value: number | null | undefined) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value ?? 0));
}

export function useSmoothUnreadCount(
    value: number | null | undefined,
    resetKey: string,
    durationMs = UNREAD_CLEAR_ANIMATION_MS,
): SmoothUnreadCountState {
    const normalizedCount = normalizeUnreadCount(value);
    const resetKeyRef = useRef(resetKey);
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countRef = useRef(normalizedCount);
    const clearingRef = useRef(false);
    const [state, setState] = useState<SmoothUnreadCountState>(() => ({
        count: normalizedCount,
        clearing: false,
    }));

    useEffect(() => {
        countRef.current = state.count;
        clearingRef.current = state.clearing;
    }, [state.count, state.clearing]);

    useEffect(() => {
        const resetKeyChanged = resetKeyRef.current !== resetKey;
        resetKeyRef.current = resetKey;

        if (clearTimerRef.current) {
            clearTimeout(clearTimerRef.current);
            clearTimerRef.current = null;
        }

        if (resetKeyChanged) {
            countRef.current = normalizedCount;
            clearingRef.current = false;
            setState({ count: normalizedCount, clearing: false });
            return;
        }

        if (normalizedCount > 0) {
            countRef.current = normalizedCount;
            clearingRef.current = false;
            setState({ count: normalizedCount, clearing: false });
            return;
        }

        const currentCount = countRef.current;
        const currentClearing = clearingRef.current;
        if (currentCount <= 0) {
            if (currentClearing) {
                countRef.current = 0;
                clearingRef.current = false;
                setState({ count: 0, clearing: false });
            }
            return;
        }

        clearingRef.current = true;
        setState((current) => ({ ...current, clearing: true }));
        clearTimerRef.current = setTimeout(() => {
            clearTimerRef.current = null;
            countRef.current = 0;
            clearingRef.current = false;
            setState({ count: 0, clearing: false });
        }, durationMs);
    }, [durationMs, normalizedCount, resetKey]);

    useEffect(() => () => {
        if (clearTimerRef.current) {
            clearTimeout(clearTimerRef.current);
            clearTimerRef.current = null;
        }
    }, []);

    return state;
}
