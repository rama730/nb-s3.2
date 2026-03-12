'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkspacePreferences, saveWorkspacePins } from '@/app/actions/workspace';
import { queryKeys } from '@/lib/query-keys';

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
const REMOTE_SAVE_MAX_ATTEMPTS = 4;
const REMOTE_SAVE_BASE_RETRY_MS = 400;
const REMOTE_SAVE_MAX_RETRY_MS = 5_000;
const PIN_TYPES = new Set<PinnedItem['type']>(['task', 'project']);

function delay(ms: number) {
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function toPinKey(item: Pick<PinnedItem, 'type' | 'id'>): string {
    return `${item.type}:${item.id}`;
}

function toPinsSignature(items: PinnedItem[]): string {
    return JSON.stringify(
        items.map((item) => [
            item.type,
            item.id,
            item.title,
            item.projectSlug ?? '',
            item.projectKey ?? '',
            item.taskNumber ?? null,
            item.projectId ?? '',
        ]),
    );
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

function readLocalPins(): PinnedItem[] {
    try {
        const saved = localStorage.getItem(KEY);
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isValidPinnedItem).slice(0, MAX);
    } catch {
        return [];
    }
}

export function useWorkspacePins() {
    const hydratedRef = useRef(false);
    const latestPinsRef = useRef<PinnedItem[]>([]);
    const localVersionRef = useRef(0);
    const pendingVersionRef = useRef(0);
    const pendingPersistSignatureRef = useRef<string | null>(null);
    const remotePersistQueueRef = useRef<Promise<void>>(Promise.resolve());
    const [pins, setPins] = useState<PinnedItem[]>([]);
    const [remotePersistError, setRemotePersistError] = useState<string | null>(null);

    useEffect(() => {
        setPins(readLocalPins());
    }, []);

    useEffect(() => {
        latestPinsRef.current = pins;
    }, [pins]);

    const persistLocal = useCallback((items: PinnedItem[]) => {
        try {
            localStorage.setItem(KEY, JSON.stringify(items));
        } catch {
            // ignore localStorage errors
        }
    }, []);

    const persistRemoteQueued = useCallback((items: PinnedItem[], version: number) => {
        remotePersistQueueRef.current = remotePersistQueueRef.current
            .catch(() => undefined)
            .then(async () => {
                setRemotePersistError(null);

                for (let attempt = 1; attempt <= REMOTE_SAVE_MAX_ATTEMPTS; attempt += 1) {
                    // A newer local version superseded this save request.
                    if (pendingVersionRef.current > version) return;

                    try {
                        const result = await saveWorkspacePins(items);
                        if (result.success) {
                            if (pendingVersionRef.current <= version) {
                                pendingVersionRef.current = 0;
                            }
                            setRemotePersistError(null);
                            return;
                        }

                        const errorMessage = result.error || 'Failed to save pins';
                        if (attempt >= REMOTE_SAVE_MAX_ATTEMPTS) {
                            console.warn('[workspace-pins] failed to save pins after retries', {
                                attempt,
                                version,
                                error: errorMessage,
                            });
                            setRemotePersistError(errorMessage);
                            return;
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Failed to save pins';
                        if (attempt >= REMOTE_SAVE_MAX_ATTEMPTS) {
                            console.warn('[workspace-pins] failed to save pins after retries', {
                                attempt,
                                version,
                                error: errorMessage,
                            });
                            setRemotePersistError(errorMessage);
                            return;
                        }
                    }

                    const retryDelayMs = Math.min(
                        REMOTE_SAVE_BASE_RETRY_MS * (2 ** (attempt - 1)),
                        REMOTE_SAVE_MAX_RETRY_MS,
                    );
                    await delay(retryDelayMs);
                }
            });
    }, []);

    const { data: preferences } = useQuery({
        queryKey: queryKeys.workspace.preferences(),
        queryFn: async () => {
            const result = await getWorkspacePreferences();
            return result.success && result.data ? result.data : null;
        },
        staleTime: 30_000,
    });

    useEffect(() => {
        if (!preferences) return;
        const serverPins = (preferences.pins ?? []).filter(isValidPinnedItem).slice(0, MAX);
        if (!hydratedRef.current) {
            hydratedRef.current = true;
            const localPins = readLocalPins();
            if (serverPins.length > 0) {
                setPins(serverPins);
                persistLocal(serverPins);
            } else if (localPins.length > 0) {
                setPins(localPins);
                const version = localVersionRef.current + 1;
                localVersionRef.current = version;
                pendingVersionRef.current = version;
                persistRemoteQueued(localPins, version);
            }
            return;
        }
        const serverSignature = toPinsSignature(serverPins);
        const localSignature = toPinsSignature(latestPinsRef.current);
        if (pendingVersionRef.current > 0 && serverSignature !== localSignature) {
            return;
        }
        if (serverSignature === localSignature) {
            if (pendingVersionRef.current > 0) {
                pendingVersionRef.current = 0;
            }
            persistLocal(serverPins);
            return;
        }
        setPins(serverPins);
        persistLocal(serverPins);
    }, [preferences, persistLocal, persistRemoteQueued]);

    useEffect(() => {
        const pendingSignature = pendingPersistSignatureRef.current;
        if (!pendingSignature) return;
        const currentSignature = toPinsSignature(pins);
        if (currentSignature !== pendingSignature) {
            pendingPersistSignatureRef.current = null;
            return;
        }
        const version = localVersionRef.current + 1;
        localVersionRef.current = version;
        pendingVersionRef.current = version;
        persistLocal(pins);
        persistRemoteQueued(pins, version);
        pendingPersistSignatureRef.current = null;
    }, [pins, persistLocal, persistRemoteQueued]);

    const addPin = useCallback((item: PinnedItem) => {
        if (!isValidPinnedItem(item)) return;
        const current = latestPinsRef.current;
        if (current.some((pin) => toPinKey(pin) === toPinKey(item))) return;
        const expectedNext = [item, ...current].slice(0, MAX);
        if (toPinsSignature(expectedNext) === toPinsSignature(current)) return;
        pendingPersistSignatureRef.current = toPinsSignature(expectedNext);

        setPins((prev) => {
            if (prev.some((pin) => toPinKey(pin) === toPinKey(item))) return prev;
            return [item, ...prev].slice(0, MAX);
        });
    }, []);

    const removePin = useCallback((item: Pick<PinnedItem, 'type' | 'id'>) => {
        const expectedNext = latestPinsRef.current.filter((pin) => toPinKey(pin) !== toPinKey(item));
        if (expectedNext.length === latestPinsRef.current.length) return;
        pendingPersistSignatureRef.current = toPinsSignature(expectedNext);

        setPins((prev) => {
            const next = prev.filter((pin) => toPinKey(pin) !== toPinKey(item));
            if (next.length === prev.length) return prev;
            return next;
        });
    }, []);

    const isPinned = useCallback(
        (item: Pick<PinnedItem, 'type' | 'id'>) => pins.some((pin) => toPinKey(pin) === toPinKey(item)),
        [pins],
    );

    return { pins, addPin, removePin, isPinned, remotePersistError };
}
