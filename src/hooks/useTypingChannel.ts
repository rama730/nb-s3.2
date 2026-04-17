'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import { useAuth } from '@/lib/hooks/use-auth';
import {
    applyTypingDelta,
    deriveTypingUsersFromPresenceState,
} from '@/lib/chat/typing-state';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';
import type { PresenceMemberProfile } from '@/lib/realtime/presence-types';

export interface TypingUser {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface UseTypingChannelReturn {
    typingUsers: TypingUser[];
    sendTyping: (isTyping: boolean) => Promise<void>;
}

// Wave 3 Step 12: TTL must cover the composer idle timer (1800 ms) + the 500 ms
// throttle floor on `isTyping=true` broadcasts + network margin so the banner
// does not flicker off while the sender is still typing bursty input.
const TYPING_VISIBLE_TTL_MS = 5_500;

export function useTypingChannel(
    conversationId: string | null,
    options: { listen?: boolean; enabled?: boolean } = { listen: true, enabled: true },
): UseTypingChannelReturn {
    const { listen, enabled = true } = options;
    const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
    const [isVisible, setIsVisible] = useState(() => typeof document === 'undefined' ? true : !document.hidden);
    const requestedTypingStateRef = useRef<boolean | null>(null);
    const lastBroadcastRef = useRef(0);
    const connectionStatusRef = useRef<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const subscriptionRef = useRef<ReturnType<typeof subscribePresenceRoom> | null>(null);
    const { user, profile } = useAuth();
    const currentUserId = user?.id ?? null;

    const currentUserProfile = useMemo<PresenceMemberProfile | null>(() => (
        currentUserId
            ? {
                username: profile?.username ?? (user?.user_metadata?.username as string | undefined) ?? null,
                fullName: profile?.fullName ?? (user?.user_metadata?.full_name as string | undefined) ?? null,
                avatarUrl: profile?.avatarUrl ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null,
            }
            : null
    ), [currentUserId, profile?.avatarUrl, profile?.fullName, profile?.username, user?.user_metadata]);

    const clearUserTimer = useCallback((userId: string) => {
        const timer = timersRef.current.get(userId);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(userId);
        }
    }, []);

    const scheduleRemoval = useCallback((member: TypingUser) => {
        clearUserTimer(member.id);
        const timer = setTimeout(() => {
            timersRef.current.delete(member.id);
            setTypingUsers((prev) => prev.filter((item) => item.id !== member.id));
        }, TYPING_VISIBLE_TTL_MS);
        timersRef.current.set(member.id, timer);
    }, [clearUserTimer]);

    const emitTypingState = useCallback((isTyping: boolean) => {
        requestedTypingStateRef.current = isTyping;
        if (!currentUserProfile) return;

        subscriptionRef.current?.send({
            type: 'typing',
            isTyping,
            profile: currentUserProfile,
        });
    }, [currentUserProfile]);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const onVisibilityChange = () => {
            setIsVisible(!document.hidden);
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    useEffect(() => {
        if (isVisible) return;
        if (requestedTypingStateRef.current) {
            emitTypingState(false);
        }
        setTypingUsers([]);
    }, [emitTypingState, isVisible]);

    useEffect(() => {
        if (!enabled || !conversationId || conversationId === 'new') {
            if (requestedTypingStateRef.current) {
                emitTypingState(false);
            }
            setTypingUsers([]);
            requestedTypingStateRef.current = null;
            connectionStatusRef.current = 'disconnected';
            timersRef.current.forEach(clearTimeout);
            timersRef.current.clear();
            return;
        }

        const subscription = subscribePresenceRoom({
            roomType: 'conversation',
            roomId: conversationId,
            role: 'viewer',
            onStatus: (status) => {
                connectionStatusRef.current = status;
                if (
                    status === 'connected'
                    && requestedTypingStateRef.current !== null
                    && currentUserProfile
                ) {
                    subscription.send({
                        type: 'typing',
                        isTyping: requestedTypingStateRef.current,
                        profile: currentUserProfile,
                    });
                }
            },
            onEvent: (event) => {
                if (!listen) return;

                if (event.type === 'presence.state') {
                    timersRef.current.forEach(clearTimeout);
                    timersRef.current.clear();
                    const nextUsers = deriveTypingUsersFromPresenceState(event.members, currentUserId);
                    for (const member of nextUsers) {
                        scheduleRemoval(member);
                    }
                    setTypingUsers(nextUsers);
                    return;
                }

                if (event.type !== 'presence.delta' || event.member.userId === currentUserId) {
                    return;
                }

                const leavingUserId = event.member.userId;
                if (event.action === 'leave' || !event.member.typing) {
                    clearUserTimer(leavingUserId);
                    setTypingUsers((prev) => applyTypingDelta({
                        currentUsers: prev,
                        member: event.member,
                        action: event.action,
                        currentUserId,
                    }));
                    return;
                }

                setTypingUsers((prev) => {
                    const nextUsers = applyTypingDelta({
                        currentUsers: prev,
                        member: event.member,
                        action: event.action,
                        currentUserId,
                    });
                    const member = nextUsers.find((item) => item.id === event.member.userId);
                    if (member) {
                        scheduleRemoval(member);
                    }
                    return nextUsers;
                });
            },
        });
        subscriptionRef.current = subscription;

        return () => {
            // Wave 3 Step 12: synchronously flush typing=false to the PREVIOUS
            // conversation's room via the captured `subscription` (not the ref,
            // which may already point at the next conversation's room if React
            // has batched the effect transition). This prevents a race where
            // the old room's "typing=true" outlives the switch.
            if (requestedTypingStateRef.current && currentUserProfile) {
                subscription.send({
                    type: 'typing',
                    isTyping: false,
                    profile: currentUserProfile,
                });
            }
            requestedTypingStateRef.current = null;
            subscription.unsubscribe();
            subscriptionRef.current = null;
            connectionStatusRef.current = 'disconnected';
            const activeTimers = timersRef.current;
            activeTimers.forEach(clearTimeout);
            timersRef.current = new Map();
        };
    }, [clearUserTimer, conversationId, currentUserId, currentUserProfile, emitTypingState, enabled, listen, scheduleRemoval]);

    useEffect(() => {
        if (
            !subscriptionRef.current
            || !currentUserProfile
            || connectionStatusRef.current !== 'connected'
            || requestedTypingStateRef.current === null
        ) {
            return;
        }

        subscriptionRef.current.send({
            type: 'typing',
            isTyping: requestedTypingStateRef.current,
            profile: currentUserProfile,
        });
    }, [currentUserProfile]);

    const sendTyping = useCallback(async (isTyping: boolean) => {
        if (!enabled || !conversationId || conversationId === 'new' || !isVisible) return;
        // throttle: skip rapid isTyping=true events
        if (isTyping) {
            const now = Date.now();
            if (now - lastBroadcastRef.current < 500) return;
            lastBroadcastRef.current = now;
        }
        requestedTypingStateRef.current = isTyping;
        if (!currentUserProfile) return;

        emitTypingState(isTyping);
    }, [conversationId, currentUserProfile, emitTypingState, enabled, isVisible]);

    return { typingUsers: listen ? typingUsers : [], sendTyping };
}
