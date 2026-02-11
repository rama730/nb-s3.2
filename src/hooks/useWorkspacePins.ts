'use client';

import { useState, useEffect, useCallback } from 'react';

export interface PinnedItem {
    type: 'task' | 'project';
    id: string;
    title: string;
    projectSlug?: string | null;
    projectKey?: string | null;
    taskNumber?: number | null;
    projectId?: string;
}

const KEY = 'workspace-pinned-items';
const MAX = 3;
const PIN_TYPES = new Set<PinnedItem['type']>(['task', 'project']);

function toPinKey(item: Pick<PinnedItem, 'type' | 'id'>): string {
    return `${item.type}:${item.id}`;
}

function isValidPinnedItem(raw: unknown): raw is PinnedItem {
    if (!raw || typeof raw !== 'object') return false;
    const value = raw as Partial<PinnedItem>;
    if (!value.id || typeof value.id !== 'string') return false;
    if (!value.title || typeof value.title !== 'string') return false;
    if (!value.type || typeof value.type !== 'string' || !PIN_TYPES.has(value.type as PinnedItem['type'])) return false;
    if (value.type === 'task' && (!value.projectId || typeof value.projectId !== 'string')) return false;
    return true;
}

/**
 * useWorkspacePins
 *
 * Manages up to 3 pinned items in localStorage.
 * Zero server cost — self-contained data at pin time.
 */
export function useWorkspacePins() {
    const [pins, setPins] = useState<PinnedItem[]>([]);

    // Hydrate from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    setPins(parsed.filter(isValidPinnedItem).slice(0, MAX));
                }
            }
        } catch {
            // localStorage unavailable
        }
    }, []);

    const persist = useCallback((items: PinnedItem[]) => {
        try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* noop */ }
    }, []);

    const addPin = useCallback((item: PinnedItem) => {
        if (!isValidPinnedItem(item)) return;
        setPins(prev => {
            if (prev.some(p => toPinKey(p) === toPinKey(item))) return prev;
            const next = [item, ...prev].slice(0, MAX);
            persist(next);
            return next;
        });
    }, [persist]);

    const removePin = useCallback((item: Pick<PinnedItem, 'type' | 'id'>) => {
        setPins(prev => {
            const next = prev.filter(p => toPinKey(p) !== toPinKey(item));
            persist(next);
            return next;
        });
    }, [persist]);

    const isPinned = useCallback(
        (item: Pick<PinnedItem, 'type' | 'id'>) => pins.some(p => toPinKey(p) === toPinKey(item)),
        [pins]
    );

    return { pins, addPin, removePin, isPinned };
}
