'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { type RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// TYPING CHANNEL HOOK (Scalable Broadcast)
// ============================================================================
// Uses Supabase Broadcast (WebSocket) to send ephemeral typing events.
// No Database writes. O(1) complexity (only listens to active room).
// ============================================================================

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

export function useTypingChannel(conversationId: string | null): UseTypingChannelReturn {
    const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
    const channelRef = useRef<RealtimeChannel | null>(null);
    const typingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
    const lastSentRef = useRef<number>(0);
    const supabase = createClient();

    // User info cache
    const currentUserRef = useRef<TypingUser | null>(null);

    // Fetch current user once
    useEffect(() => {
        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (user) {
                // We need profile info to send with the event
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('username, full_name, avatar_url')
                    .eq('id', user.id)
                    .single();

                currentUserRef.current = {
                    id: user.id,
                    username: profile?.username || null,
                    fullName: profile?.full_name || null,
                    avatarUrl: profile?.avatar_url || null
                };
            }
        });
    }, []);

    // Subscribe to Broadcast Channel
    useEffect(() => {
        if (!conversationId || conversationId === 'new') {
            setTypingUsers([]);
            return;
        }

        const channelId = `room:${conversationId}`;
        const channel = supabase.channel(channelId);

        channel
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                // Ignore our own events (though broadcast usually excludes self, good to be safe)
                if (payload.user?.id === currentUserRef.current?.id) return;

                handleTypingEvent(payload.user, payload.isTyping);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`[Typing] Subscribed to ${channelId}`);
                }
            });

        channelRef.current = channel;

        return () => {
            console.log(`[Typing] Unsubscribing from ${channelId}`);
            supabase.removeChannel(channel);
            channelRef.current = null;
            // Clear all local typing state
            setTypingUsers([]);
            typingTimersRef.current.forEach(clearTimeout);
            typingTimersRef.current.clear();
        };
    }, [conversationId]);

    // Handle incoming events
    const handleTypingEvent = useCallback((user: TypingUser, isTyping: boolean) => {
        if (!user || !user.id) return;

        setTypingUsers(prev => {
            const exists = prev.some(u => u.id === user.id);

            // 1. If STOP typing
            if (!isTyping) {
                if (exists) {
                    // Clear safety timer if exists
                    const timer = typingTimersRef.current.get(user.id);
                    if (timer) clearTimeout(timer);
                    typingTimersRef.current.delete(user.id);
                    return prev.filter(u => u.id !== user.id);
                }
                return prev;
            }

            // 2. If START typing

            // Allow refresh of existing user (to update timer)
            // We set a safety timer to auto-remove if no 'stop' event comes (e.g. tab closed)
            const existingTimer = typingTimersRef.current.get(user.id);
            if (existingTimer) clearTimeout(existingTimer);

            const newTimer = setTimeout(() => {
                setTypingUsers(current => current.filter(u => u.id !== user.id));
                typingTimersRef.current.delete(user.id);
            }, 3500); // 3.5s safety timeout (sender pulses every 2s)

            typingTimersRef.current.set(user.id, newTimer);

            if (!exists) {
                return [...prev, user];
            }
            return prev;
        });
    }, []);

    // Send typing status
    const sendTyping = useCallback(async (isTyping: boolean) => {
        if (!channelRef.current || !currentUserRef.current) return;

        const now = Date.now();
        // Throttle "isTyping=true" to every 2 seconds
        if (isTyping && now - lastSentRef.current < 2000) {
            return;
        }

        try {
            await channelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload: {
                    user: currentUserRef.current,
                    isTyping
                }
            });

            if (isTyping) {
                lastSentRef.current = now;
            } else {
                // If stopping, reset throttler so next start is immediate
                lastSentRef.current = 0;
            }
        } catch (error) {
            console.error('[Typing] Failed to send event:', error);
        }
    }, []);

    return { typingUsers, sendTyping };
}
