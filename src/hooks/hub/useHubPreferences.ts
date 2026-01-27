'use client';

import { useEffect } from 'react';
import { HubFilters } from '@/types/hub';

interface HubPreferences {
    hub_view_mode?: string;
    hub_sort_by?: string;
    hub_filters?: Partial<HubFilters>;
}

export function useHubPreferences(
    userId: string | null,
    currentFilters: HubFilters,
    viewMode: string,
    sortBy: string
) {
    // Save preferences to localStorage
    useEffect(() => {
        if (!userId) return;

        const prefs: HubPreferences = {
            hub_view_mode: viewMode,
            hub_sort_by: sortBy,
            hub_filters: {
                status: currentFilters.status,
                type: currentFilters.type,
                tech: currentFilters.tech,
            },
        };

        localStorage.setItem(`hub-preferences-${userId}`, JSON.stringify(prefs));
    }, [userId, currentFilters, viewMode, sortBy]);

    // Load preferences from localStorage
    const loadPreferences = (): HubPreferences | null => {
        if (!userId) return null;

        try {
            const stored = localStorage.getItem(`hub-preferences-${userId}`);
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    };

    return {
        preferences: loadPreferences(),
    };
}
