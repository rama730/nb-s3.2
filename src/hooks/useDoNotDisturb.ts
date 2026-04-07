'use client';

import { useCallback, useEffect, useState } from 'react';

const DND_STORAGE_KEY = 'messages-v2-dnd';

interface DndState {
    enabled: boolean;
    until: number | null; // epoch ms
}

function loadDndState(): DndState {
    if (typeof localStorage === 'undefined') return { enabled: false, until: null };
    try {
        const raw = localStorage.getItem(DND_STORAGE_KEY);
        if (!raw) return { enabled: false, until: null };
        const parsed = JSON.parse(raw) as DndState;
        // Check if timed DND has expired
        if (parsed.until && Date.now() > parsed.until) {
            localStorage.removeItem(DND_STORAGE_KEY);
            return { enabled: false, until: null };
        }
        return parsed;
    } catch {
        return { enabled: false, until: null };
    }
}

export function useDoNotDisturb() {
    const [state, setState] = useState<DndState>(loadDndState);

    useEffect(() => {
        // Check expiry periodically
        const timer = setInterval(() => {
            if (state.until && Date.now() > state.until) {
                setState({ enabled: false, until: null });
                localStorage.removeItem(DND_STORAGE_KEY);
            }
        }, 60_000);
        return () => clearInterval(timer);
    }, [state.until]);

    const toggle = useCallback((duration?: number) => {
        setState((prev) => {
            const next: DndState = prev.enabled
                ? { enabled: false, until: null }
                : { enabled: true, until: duration ? Date.now() + duration : null };
            localStorage.setItem(DND_STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    return {
        isDnd: state.enabled,
        dndUntil: state.until ? new Date(state.until) : null,
        toggleDnd: toggle,
    };
}
