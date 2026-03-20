'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import { useAuth } from '@/lib/hooks/use-auth';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';
import type { PresenceMemberState, PresenceMemberProfile } from '@/lib/realtime/presence-types';

interface TypingUser {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface UseTypingChannelReturn {
    typingUsers: TypingUser[];
    sendTyping: (isTyping: boolean) => Promise<void>;
}

const TYPING_VISIBLE_TTL_MS = 3_500;

function toTypingUser(member: PresenceMemberState): TypingUser {
    return {
        id: member.userId,
        username: member.profile?.username ?? null,
        fullName: member.profile?.fullName ?? member.userName ?? null,
        avatarUrl: member.profile?.avatarUrl ?? null,
    };
}

export function useTypingChannel(conversationId: string | null, options: { listen?: boolean } = { listen: true }): UseTypingChannelReturn {
    const { listen } = options;
    const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
    const [isVisible, setIsVisible] = useState(() => typeof document === 'undefined' ? true : !document.hidden);
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
        if (!conversationId || conversationId === 'new' || !isVisible) {
            setTypingUsers([]);
            timersRef.current.forEach(clearTimeout);
            timersRef.current.clear();
            return;
        }

        const subscription = subscribePresenceRoom({
            roomType: 'conversation',
            roomId: conversationId,
            role: 'viewer',
            onEvent: (event) => {
                if (!listen) return;

                if (event.type === 'presence.state') {
                    timersRef.current.forEach(clearTimeout);
                    timersRef.current.clear();
                    const nextUsers = event.members
                        .filter((member) => member.typing && member.userId !== currentUserId)
                        .map((member) => toTypingUser(member));
                    for (const member of nextUsers) {
                        scheduleRemoval(member);
                    }
                    setTypingUsers(nextUsers);
                    return;
                }

                if (event.type !== 'presence.delta' || event.member.userId === currentUserId) {
                    return;
                }

                const member = toTypingUser(event.member);
                if (event.action === 'leave' || !event.member.typing) {
                    clearUserTimer(member.id);
                    setTypingUsers((prev) => prev.filter((item) => item.id !== member.id));
                    return;
                }

                scheduleRemoval(member);
                setTypingUsers((prev) => {
                    const existing = prev.some((item) => item.id === member.id);
                    if (existing) {
                        return prev.map((item) => item.id === member.id ? member : item);
                    }
                    return [...prev, member];
                });
            },
        });
        subscriptionRef.current = subscription;
        const activeTimers = timersRef.current;

        return () => {
            subscription.unsubscribe();
            subscriptionRef.current = null;
            activeTimers.forEach(clearTimeout);
            activeTimers.clear();
        };
    }, [clearUserTimer, conversationId, currentUserId, isVisible, listen, scheduleRemoval]);

    const sendTyping = useCallback(async (isTyping: boolean) => {
        if (!conversationId || conversationId === 'new' || !isVisible) return;
        if (!currentUserProfile) return;

        subscriptionRef.current?.send({
            type: 'typing',
            isTyping,
            profile: currentUserProfile,
        });
    }, [conversationId, currentUserProfile, isVisible]);

    return { typingUsers: listen ? typingUsers : [], sendTyping };
}
