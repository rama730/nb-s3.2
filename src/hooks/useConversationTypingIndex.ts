'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/hooks/use-auth';
import {
    applyTypingDelta,
    deriveTypingUsersFromPresenceState,
    normalizeTrackedConversationIds,
} from '@/lib/chat/typing-state';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';

import type { TypingUser } from './useTypingChannel';

const TYPING_VISIBLE_TTL_MS = 3_500;

export function useConversationTypingIndex(
    conversationIds: ReadonlyArray<string | null | undefined>,
    options: { enabled?: boolean } = {},
) {
    const { enabled = true } = options;
    const { user } = useAuth();
    const currentUserId = user?.id ?? null;
    const [typingUsersByConversation, setTypingUsersByConversation] = useState<Record<string, TypingUser[]>>({});
    const typingUsersByConversationRef = useRef<Record<string, TypingUser[]>>({});
    const [isVisible, setIsVisible] = useState(() => typeof document === 'undefined' ? true : !document.hidden);
    const currentUserIdRef = useRef(currentUserId);
    const subscriptionsRef = useRef(new Map<string, ReturnType<typeof subscribePresenceRoom>>());
    const timersRef = useRef(new Map<string, Map<string, ReturnType<typeof setTimeout>>>());
    const trackedConversationIds = useMemo(
        () => normalizeTrackedConversationIds(conversationIds),
        [conversationIds],
    );

    const clearConversationTimers = useCallback((conversationId: string) => {
        const conversationTimers = timersRef.current.get(conversationId);
        if (!conversationTimers) return;
        conversationTimers.forEach(clearTimeout);
        timersRef.current.delete(conversationId);
    }, []);

    const clearUserTimer = useCallback((conversationId: string, userId: string) => {
        const conversationTimers = timersRef.current.get(conversationId);
        if (!conversationTimers) return;
        const timer = conversationTimers.get(userId);
        if (!timer) return;
        clearTimeout(timer);
        conversationTimers.delete(userId);
        if (conversationTimers.size === 0) {
            timersRef.current.delete(conversationId);
        }
    }, []);

    const updateTypingUsersState = useCallback((
        updater: (current: Record<string, TypingUser[]>) => Record<string, TypingUser[]>,
    ) => {
        const current = typingUsersByConversationRef.current;
        const next = updater(current);
        if (next === current) return;
        typingUsersByConversationRef.current = next;
        setTypingUsersByConversation(next);
    }, []);

    const scheduleRemoval = useCallback((conversationId: string, member: TypingUser) => {
        clearUserTimer(conversationId, member.id);

        const conversationTimers = timersRef.current.get(conversationId) ?? new Map<string, ReturnType<typeof setTimeout>>();
        const timer = setTimeout(() => {
            const nextConversationTimers = timersRef.current.get(conversationId);
            nextConversationTimers?.delete(member.id);
            if (nextConversationTimers && nextConversationTimers.size === 0) {
                timersRef.current.delete(conversationId);
            }

            updateTypingUsersState((current) => {
                const existing = current[conversationId];
                if (!existing?.length) return current;
                const nextUsers = existing.filter((item) => item.id !== member.id);
                if (nextUsers.length === existing.length) return current;
                if (nextUsers.length === 0) {
                    const { [conversationId]: _removed, ...rest } = current;
                    return rest;
                }
                return {
                    ...current,
                    [conversationId]: nextUsers,
                };
            });
        }, TYPING_VISIBLE_TTL_MS);

        conversationTimers.set(member.id, timer);
        timersRef.current.set(conversationId, conversationTimers);
    }, [clearUserTimer, updateTypingUsersState]);

    // Sync ref on every render — no useEffect delay.
    currentUserIdRef.current = currentUserId;

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
        return () => {
            subscriptionsRef.current.forEach((subscription) => subscription.unsubscribe());
            subscriptionsRef.current.clear();
            timersRef.current.forEach((conversationTimers) => {
                conversationTimers.forEach(clearTimeout);
            });
            timersRef.current.clear();
        };
    }, []);

    useEffect(() => {
        if (enabled) return;
        subscriptionsRef.current.forEach((subscription) => subscription.unsubscribe());
        subscriptionsRef.current.clear();
        timersRef.current.forEach((conversationTimers) => {
            conversationTimers.forEach(clearTimeout);
        });
        timersRef.current.clear();
        updateTypingUsersState(() => ({}));
    }, [enabled, updateTypingUsersState]);

    useEffect(() => {
        if (!isVisible) {
            subscriptionsRef.current.forEach((subscription) => subscription.unsubscribe());
            subscriptionsRef.current.clear();
            timersRef.current.forEach((conversationTimers) => {
                conversationTimers.forEach(clearTimeout);
            });
            timersRef.current.clear();
            updateTypingUsersState(() => ({}));
            return;
        }

        if (!enabled) {
            return;
        }

        const nextConversationIds = new Set(trackedConversationIds);

        subscriptionsRef.current.forEach((subscription, conversationId) => {
            if (nextConversationIds.has(conversationId)) return;
            subscription.unsubscribe();
            subscriptionsRef.current.delete(conversationId);
            clearConversationTimers(conversationId);
            updateTypingUsersState((current) => {
                if (!(conversationId in current)) return current;
                const { [conversationId]: _removed, ...rest } = current;
                return rest;
            });
        });

        for (const conversationId of trackedConversationIds) {
            if (subscriptionsRef.current.has(conversationId)) continue;

            const subscription = subscribePresenceRoom({
                roomType: 'conversation',
                roomId: conversationId,
                onEvent: (event) => {
                    if (event.type === 'presence.state') {
                        clearConversationTimers(conversationId);
                        const nextUsers = deriveTypingUsersFromPresenceState(event.members, currentUserIdRef.current);

                        nextUsers.forEach((member) => {
                            scheduleRemoval(conversationId, member);
                        });

                        updateTypingUsersState((current) => {
                            if (nextUsers.length === 0) {
                                if (!(conversationId in current)) return current;
                                const { [conversationId]: _removed, ...rest } = current;
                                return rest;
                            }
                            return {
                                ...current,
                                [conversationId]: nextUsers,
                            };
                        });
                        return;
                    }

                    if (event.type !== 'presence.delta' || event.member.userId === currentUserIdRef.current) {
                        return;
                    }

                    if (event.action === 'leave' || !event.member.typing) {
                        clearUserTimer(conversationId, event.member.userId);
                        updateTypingUsersState((current) => {
                            const existingUsers = current[conversationId] ?? [];
                            const nextUsers = applyTypingDelta({
                                currentUsers: existingUsers,
                                member: event.member,
                                action: event.action,
                                currentUserId: currentUserIdRef.current,
                            });
                            if (nextUsers.length === 0) {
                                if (!(conversationId in current)) return current;
                                const { [conversationId]: _removed, ...rest } = current;
                                return rest;
                            }
                            return {
                                ...current,
                                [conversationId]: nextUsers,
                            };
                        });
                        return;
                    }

                    updateTypingUsersState((current) => {
                        const existingUsers = current[conversationId] ?? [];
                        const nextUsers = applyTypingDelta({
                            currentUsers: existingUsers,
                            member: event.member,
                            action: event.action,
                            currentUserId: currentUserIdRef.current,
                        });
                        if (nextUsers.length === 0) {
                            if (!(conversationId in current)) return current;
                            const { [conversationId]: _removed, ...rest } = current;
                            return rest;
                        }
                        const memberToSchedule = nextUsers.find((item) => item.id === event.member.userId);
                        if (memberToSchedule) {
                            // Schedule outside the synchronous updater via microtask
                            queueMicrotask(() => scheduleRemoval(conversationId, memberToSchedule));
                        }
                        return {
                            ...current,
                            [conversationId]: nextUsers,
                        };
                    });
                },
            });

            subscriptionsRef.current.set(conversationId, subscription);
        }
    }, [clearConversationTimers, clearUserTimer, enabled, isVisible, scheduleRemoval, trackedConversationIds, updateTypingUsersState]);

    return typingUsersByConversation;
}
