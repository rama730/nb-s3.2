'use client';

/**
 * Wave 2 — Presence & online dot.
 *
 * Observes "who is currently online" for a set of peer user IDs by subscribing
 * to per-user presence rooms (`user:${id}`) with viewer role. A user is
 * considered online when their own client is connected to their own
 * `user:${id}` room (self-publish — see `usePublishOnlinePresence`).
 *
 * Authorization: the `/api/realtime/presence-token` route permits a viewer to
 * observe a user room only when the viewer shares at least one conversation
 * with the target — see `assertPresenceRoomAccess` in the route handler.
 *
 * Returns a stable `Record<string, boolean>` that only changes when the
 * online set actually changes, so consumers can compare by reference /
 * memoize safely.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { subscribePresenceRoom } from '@/lib/realtime/presence-client';
import type {
    PresenceMemberState,
    PresenceServerEvent,
} from '@/lib/realtime/presence-types';

type OnlineMap = Record<string, boolean>;

type RoomSubscription = ReturnType<typeof subscribePresenceRoom>;

interface RoomTracker {
    // Connection IDs of the owner's sockets currently joined to their room.
    // Size > 0 ⇒ user is online. Multi-device supported naturally.
    connectionIds: Set<string>;
    subscription: RoomSubscription | null;
}

/**
 * Subscribe to per-user presence rooms for the given peer user IDs.
 *
 * @param userIds  Peer user IDs to observe. Pass an empty array to unsubscribe
 *                 from everything. Order does not matter; the hook dedupes.
 * @returns        Mapping from userId → online boolean. Only changes when the
 *                 online status of at least one watched user changes.
 */
export function useOnlineUsers(userIds: string[]): OnlineMap {
    // Sort+dedupe so the dependency for the main effect is stable across
    // renders that pass the same set in different order.
    const stableIds = useMemo(() => {
        const deduped = Array.from(new Set(userIds.filter(Boolean)));
        deduped.sort();
        return deduped;
    }, [userIds]);

    const [onlineMap, setOnlineMap] = useState<OnlineMap>({});
    const trackersRef = useRef<Map<string, RoomTracker>>(new Map());

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const trackers = trackersRef.current;
        const desiredIds = new Set(stableIds);

        // 1. Unsubscribe from rooms we no longer care about.
        for (const [userId, tracker] of Array.from(trackers.entries())) {
            if (desiredIds.has(userId)) continue;
            tracker.subscription?.unsubscribe();
            trackers.delete(userId);
            setOnlineMap((prev) => {
                if (!(userId in prev)) return prev;
                const { [userId]: _removed, ...rest } = prev;
                return rest;
            });
        }

        // 2. Subscribe to new user rooms.
        for (const userId of stableIds) {
            if (trackers.has(userId)) continue;

            const tracker: RoomTracker = {
                connectionIds: new Set(),
                subscription: null,
            };
            trackers.set(userId, tracker);

            const recomputeOnline = () => {
                const online = tracker.connectionIds.size > 0;
                setOnlineMap((prev) => {
                    if (prev[userId] === online) return prev;
                    return { ...prev, [userId]: online };
                });
            };

            const applyMember = (member: PresenceMemberState) => {
                // The room is scoped to a single user, but presence-server also
                // broadcasts viewers' joins (as members with their own userIds).
                // Online is only true when the room OWNER (userId === roomId)
                // has at least one live socket.
                if (member.userId !== userId) return;
                tracker.connectionIds.add(member.connectionId);
            };

            const removeMember = (member: PresenceMemberState) => {
                if (member.userId !== userId) return;
                tracker.connectionIds.delete(member.connectionId);
            };

            const handleEvent = (event: PresenceServerEvent) => {
                if (event.type === 'presence.state') {
                    tracker.connectionIds.clear();
                    for (const member of event.members) {
                        applyMember(member);
                    }
                    recomputeOnline();
                    return;
                }

                if (event.type !== 'presence.delta') {
                    return;
                }

                if (event.action === 'upsert') {
                    applyMember(event.member);
                } else if (event.action === 'leave') {
                    removeMember(event.member);
                }
                recomputeOnline();
            };

            const handleStatus = (status: 'connecting' | 'connected' | 'disconnected' | 'error') => {
                // When the websocket drops, drop our view of this room until a
                // fresh presence.state snapshot arrives on reconnect. This
                // prevents the online dot from sticking "on" forever if the
                // transport dies.
                if (status === 'disconnected' || status === 'error') {
                    if (tracker.connectionIds.size > 0) {
                        tracker.connectionIds.clear();
                        recomputeOnline();
                    }
                }
            };

            tracker.subscription = subscribePresenceRoom({
                roomType: 'user',
                roomId: userId,
                role: 'viewer',
                onEvent: handleEvent,
                onStatus: handleStatus,
            });
        }

        // No cleanup here — stableIds changes are applied incrementally at
        // the top of the effect body (we unsubscribe rooms that fell out of
        // the desired set and subscribe new ones). If we tore everything down
        // in cleanup, every id change would thrash the WebSocket subscriptions.
    }, [stableIds]);

    // Unmount-only cleanup: release every tracked subscription when the
    // consumer (e.g. conversation list) itself unmounts.
    useEffect(() => {
        const trackers = trackersRef.current;
        return () => {
            for (const tracker of trackers.values()) {
                tracker.subscription?.unsubscribe();
            }
            trackers.clear();
        };
    }, []);

    return onlineMap;
}
