'use client';

/**
 * Wave 2 — Presence & online dot.
 *
 * Self-publishes the viewer's online state by joining `user:${viewerId}` with
 * editor role. The presence WebSocket client automatically keeps this room
 * live via its heartbeat cycle, so simply being mounted is enough for peers
 * (who observe via `useOnlineUsers`) to see the viewer as online.
 *
 * Mount this hook exactly once per client session — near the messaging
 * workspace root (e.g. `MessagesWorkspaceV2`, `ChatProvider`). Stacking
 * additional instances is safe but redundant (the underlying presence client
 * dedupes identical room subscriptions).
 */

import { useEffect } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';

export function usePublishOnlinePresence() {
    const { user } = useAuth();
    const viewerUserId = user?.id ?? null;

    useEffect(() => {
        if (!viewerUserId || typeof window === 'undefined') return;

        // A no-op event listener keeps the subscription alive. We don't need
        // the `onEvent` payloads here — our presence is published implicitly
        // by the WebSocket being connected and heartbeating.
        const subscription = subscribePresenceRoom({
            roomType: 'user',
            roomId: viewerUserId,
            role: 'editor',
            onEvent: () => {
                /* intentional no-op: see docstring */
            },
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [viewerUserId]);
}
