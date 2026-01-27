'use client';

import { useEffect, useState } from 'react';
import { HubFilters } from '@/types/hub';

interface PersistedState {
    view: string;
    filters: HubFilters;
    viewMode: string;
}

const STORAGE_KEY = 'hub-filter-state';

export function useFilterPersistence(
    currentState: PersistedState,
    enabled: boolean
) {
    const [persistedState, setPersistedState] = useState<PersistedState | null>(null);

    // Load on mount
    useEffect(() => {
        if (!enabled) return;

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setPersistedState(JSON.parse(stored));
            }
        } catch {
            // Ignore errors
        }
    }, [enabled]);

    // Save on change
    useEffect(() => {
        if (!enabled) return;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
        } catch {
            // Ignore errors
        }
    }, [currentState, enabled]);

    return { persistedState };
}
