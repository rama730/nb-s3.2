'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/hooks/use-auth';
import { subscribePresenceRoom, type PresenceStatus } from '@/lib/realtime/presence-client';
import type {
    PresenceMemberProfile,
    PresenceMemberState,
    PresenceRoomType,
    PresenceTypingContext,
} from '@/lib/realtime/presence-types';

export const PRESENCE_TYPING_VISIBLE_TTL_MS = 5_500;

type RequestedTypingState = {
    isTyping: boolean;
    context: PresenceTypingContext | null;
} | null;

type UsePresenceTypingParams = {
    roomType: PresenceRoomType;
    roomId: string | null;
    enabled?: boolean;
    listen?: boolean;
    requireCurrentUser?: boolean;
    isEligibleRoomId?: (roomId: string) => boolean;
    shouldTrackMember?: (member: PresenceMemberState, currentUserId: string | null) => boolean;
};

type SendPresenceTypingParams = {
    isTyping: boolean;
    context?: PresenceTypingContext | null;
};

const DEFAULT_SHOULD_TRACK = (member: PresenceMemberState, currentUserId: string | null) => (
    member.typing && member.userId !== currentUserId
);

export function usePresenceTyping({
    roomType,
    roomId,
    enabled = true,
    listen = true,
    requireCurrentUser = false,
    isEligibleRoomId,
    shouldTrackMember = DEFAULT_SHOULD_TRACK,
}: UsePresenceTypingParams) {
    const { user, profile } = useAuth();
    const currentUserId = user?.id ?? null;
    const [typingMembers, setTypingMembers] = useState<PresenceMemberState[]>([]);
    const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>('disconnected');
    const [isVisible, setIsVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
    const subscriptionRef = useRef<ReturnType<typeof subscribePresenceRoom> | null>(null);
    const memberStatesRef = useRef<Map<string, PresenceMemberState>>(new Map());
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const lastBroadcastRef = useRef(0);
    const requestedTypingStateRef = useRef<RequestedTypingState>(null);

    const currentUserProfile = useMemo<PresenceMemberProfile | null>(() => (
        currentUserId
            ? {
                username: profile?.username ?? (user?.user_metadata?.username as string | undefined) ?? null,
                fullName: profile?.fullName ?? (user?.user_metadata?.full_name as string | undefined) ?? null,
                avatarUrl: profile?.avatarUrl ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null,
            }
            : null
    ), [currentUserId, profile?.avatarUrl, profile?.fullName, profile?.username, user?.user_metadata]);

    const rebuildTypingMembers = useCallback(() => {
        setTypingMembers(Array.from(memberStatesRef.current.values()));
    }, []);

    const clearMemberTimer = useCallback((userId: string) => {
        const timer = timersRef.current.get(userId);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(userId);
        }
    }, []);

    const removeMember = useCallback((userId: string) => {
        clearMemberTimer(userId);
        memberStatesRef.current.delete(userId);
        rebuildTypingMembers();
    }, [clearMemberTimer, rebuildTypingMembers]);

    const scheduleRemoval = useCallback((userId: string) => {
        clearMemberTimer(userId);
        const timer = setTimeout(() => {
            timersRef.current.delete(userId);
            memberStatesRef.current.delete(userId);
            rebuildTypingMembers();
        }, PRESENCE_TYPING_VISIBLE_TTL_MS);
        timersRef.current.set(userId, timer);
    }, [clearMemberTimer, rebuildTypingMembers]);

    const clearTrackedMembers = useCallback(() => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current.clear();
        memberStatesRef.current.clear();
        setTypingMembers([]);
    }, []);

    const sendPresenceTyping = useCallback((state: RequestedTypingState) => {
        if (!subscriptionRef.current || !currentUserProfile) return;
        subscriptionRef.current.send({
            type: 'typing',
            userId: currentUserId ?? undefined,
            isTyping: state?.isTyping ?? false,
            profile: currentUserProfile,
            context: state?.context ?? null,
        });
    }, [currentUserId, currentUserProfile]);

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
        if (requestedTypingStateRef.current?.isTyping) {
            requestedTypingStateRef.current = { isTyping: false, context: null };
            sendPresenceTyping(requestedTypingStateRef.current);
        }
        clearTrackedMembers();
    }, [clearTrackedMembers, isVisible, sendPresenceTyping]);

    useEffect(() => {
        const roomIsEligible = Boolean(roomId && (!isEligibleRoomId || isEligibleRoomId(roomId)));
        if (!enabled || !roomId || !roomIsEligible || (requireCurrentUser && !currentUserId)) {
            requestedTypingStateRef.current = null;
            clearTrackedMembers();
            setPresenceStatus('disconnected');
            subscriptionRef.current?.unsubscribe();
            subscriptionRef.current = null;
            return;
        }

        const subscription = subscribePresenceRoom({
            roomType,
            roomId,
            role: 'viewer',
            onStatus: (nextStatus) => {
                setPresenceStatus(nextStatus);
                if (nextStatus === 'connected' && requestedTypingStateRef.current?.isTyping) {
                    sendPresenceTyping(requestedTypingStateRef.current);
                }
            },
            onEvent: (event) => {
                if (!listen) return;

                if (event.type === 'presence.state') {
                    timersRef.current.forEach(clearTimeout);
                    timersRef.current.clear();
                    memberStatesRef.current = new Map();
                    for (const member of event.members) {
                        if (!shouldTrackMember(member, currentUserId)) continue;
                        memberStatesRef.current.set(member.userId, member);
                        scheduleRemoval(member.userId);
                    }
                    rebuildTypingMembers();
                    return;
                }

                if (event.type !== 'presence.delta') return;

                if (!shouldTrackMember(event.member, currentUserId) || event.action === 'leave') {
                    removeMember(event.member.userId);
                    return;
                }

                memberStatesRef.current.set(event.member.userId, event.member);
                scheduleRemoval(event.member.userId);
                rebuildTypingMembers();
            },
        });

        subscriptionRef.current = subscription;

        return () => {
            if (requestedTypingStateRef.current?.isTyping && currentUserProfile) {
                subscription.send({
                    type: 'typing',
                    userId: currentUserId ?? undefined,
                    isTyping: false,
                    profile: currentUserProfile,
                    context: null,
                });
            }
            requestedTypingStateRef.current = null;
            subscription.unsubscribe();
            subscriptionRef.current = null;
            clearTrackedMembers();
            setPresenceStatus('disconnected');
        };
    }, [
        clearTrackedMembers,
        currentUserId,
        currentUserProfile,
        enabled,
        isEligibleRoomId,
        listen,
        rebuildTypingMembers,
        removeMember,
        requireCurrentUser,
        roomId,
        roomType,
        scheduleRemoval,
        sendPresenceTyping,
        shouldTrackMember,
    ]);

    useEffect(() => {
        if (
            !subscriptionRef.current
            || !currentUserProfile
            || presenceStatus !== 'connected'
            || !requestedTypingStateRef.current?.isTyping
        ) {
            return;
        }

        sendPresenceTyping(requestedTypingStateRef.current);
    }, [currentUserProfile, presenceStatus, sendPresenceTyping]);

    const sendTyping = useCallback(async ({ isTyping, context = null }: SendPresenceTypingParams) => {
        const roomIsEligible = Boolean(roomId && (!isEligibleRoomId || isEligibleRoomId(roomId)));
        if (!enabled || !roomId || !roomIsEligible || !isVisible || (requireCurrentUser && !currentUserId)) return;
        if (!currentUserProfile) return;

        if (isTyping) {
            const now = Date.now();
            if (now - lastBroadcastRef.current < 500) return;
            lastBroadcastRef.current = now;
        }

        requestedTypingStateRef.current = { isTyping, context: isTyping ? context : null };
        sendPresenceTyping(requestedTypingStateRef.current);
    }, [
        currentUserId,
        currentUserProfile,
        enabled,
        isEligibleRoomId,
        isVisible,
        requireCurrentUser,
        roomId,
        sendPresenceTyping,
    ]);

    return useMemo(() => ({
        typingMembers: listen ? typingMembers : [],
        presenceStatus,
        sendTyping,
    }), [listen, presenceStatus, sendTyping, typingMembers]);
}
