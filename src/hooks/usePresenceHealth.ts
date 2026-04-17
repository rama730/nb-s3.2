'use client';

import { useSyncExternalStore } from 'react';

import {
    getPresenceHealthSnapshot,
    subscribePresenceHealth,
} from '@/lib/realtime/presence-client';

export function usePresenceHealth() {
    return useSyncExternalStore(
        subscribePresenceHealth,
        getPresenceHealthSnapshot,
        getPresenceHealthSnapshot,
    );
}
