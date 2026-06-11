'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'hub-session-seen-projects';

export function useHubSessionSeen() {
    const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
    const [hideSeen, setHideSeen] = useState(false);
    const initializedRef = useRef(false);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as string[];
            setSeenIds(new Set(parsed));
        } catch {
            // no-op
        }
        initializedRef.current = true;
    }, []);

    // Persist seenIds to sessionStorage whenever they change (after initialization)
    useEffect(() => {
        if (!initializedRef.current) return;
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seenIds).slice(-500)));
        } catch {
            // no-op
        }
    }, [seenIds]);

    const markSeen = useCallback((projectId: string) => {
        setSeenIds((prev) => {
            if (prev.has(projectId)) return prev;
            const next = new Set(prev);
            next.add(projectId);
            return next;
        });
    }, []);

    const clearSeen = useCallback(() => {
        setSeenIds(new Set());
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch {
            // no-op
        }
    }, []);

    return useMemo(() => ({
        seenIds,
        hideSeen,
        setHideSeen,
        markSeen,
        clearSeen,
    }), [seenIds, hideSeen, markSeen, clearSeen]);
}
