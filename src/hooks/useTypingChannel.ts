'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { type RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// TYPING CHANNEL HOOK (Scalable Broadcast + Singleton Subscription)
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

// ----------------------------------------------------------------------------
// SINGLETON REGISTRY
// Manages one connection per conversation, preventing duplicate subscriptions
// ----------------------------------------------------------------------------

interface ChannelEntry {
    channel: RealtimeChannel;
    refCount: number;
    typingUsers: TypingUser[]; // Current state
    listeners: Set<(users: TypingUser[]) => void>; // Local state setters
    timers: Map<string, NodeJS.Timeout>; // Debounce timers
    lastSent: number; // For throttling sends
}

// Map<ConversationID, ChannelEntry>
const channelRegistry = new Map<string, ChannelEntry>();

// Singleton promise to fetch user once across all instances
let currentUserPromise: Promise<TypingUser | null> | null = null;

function getCurrentUser(supabase: any) {
    if (!currentUserPromise) {
        currentUserPromise = (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return null;

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('id, username, full_name, avatar_url')
                    .eq('id', user.id)
                    .single();

                if (profile) {
                    return {
                        id: profile.id,
                        username: profile.username || null,
                        fullName: profile.full_name || null,
                        avatarUrl: profile.avatar_url || null
                    };
                }
                return null;
            } catch (error) {
                console.error('Failed to fetch current user for typing:', error);
                return null;
            }
        })();
    }
    return currentUserPromise;
}

export function useTypingChannel(conversationId: string | null, options: { listen?: boolean } = { listen: true }): UseTypingChannelReturn {
    const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
    const supabase = createClient();
    const { listen } = options;

    // Effect: Manage Subscription via Registry
    useEffect(() => {
        if (!conversationId || conversationId === 'new') {
            setTypingUsers([]);
            return;
        }

        // 1. Get or Create Entry
        let entry = channelRegistry.get(conversationId);

        if (!entry) {
            const channelId = `typing:${conversationId}`;
            const channel = supabase.channel(channelId);

            entry = {
                channel,
                refCount: 0,
                typingUsers: [],
                listeners: new Set(),
                timers: new Map(),
                lastSent: 0
            };

            channelRegistry.set(conversationId, entry);

            // Subscribe logic
            channel
                .on('broadcast', { event: 'typing' }, async ({ payload }: { payload: { user: TypingUser; isTyping: boolean } }) => {
                    const currentEntry = channelRegistry.get(conversationId);
                    if (!currentEntry) return;

                    // Filter self
                    const currentUser = await getCurrentUser(supabase);
                    if (payload.user?.id === currentUser?.id) return;

                    handleRegistryEvent(conversationId, payload.user, payload.isTyping);
                })
                .subscribe((status: string) => {
                    // if (status === 'SUBSCRIBED') console.log(`[Typing] Connected ${channelId}`);
                });
        }

        // 2. Register Listener
        entry.refCount++;

        // Listener callback updates LOCAL state
        const listener = (users: TypingUser[]) => {
            if (listen) {
                setTypingUsers(users);
            }
        };

        if (listen) {
            entry.listeners.add(listener);
            // Initialize with current state
            setTypingUsers(entry.typingUsers);
        }

        // 3. Cleanup
        return () => {
            const currentEntry = channelRegistry.get(conversationId);
            if (!currentEntry) return;

            currentEntry.refCount--;
            if (listen) {
                currentEntry.listeners.delete(listener);
            }

            // Only destroy channel if NO refs left
            if (currentEntry.refCount <= 0) {
                supabase.removeChannel(currentEntry.channel);
                // Clear timers
                currentEntry.timers.forEach(clearTimeout);
                channelRegistry.delete(conversationId);
            }
        };
    }, [conversationId, supabase, listen]);

    // Helper: Handle Event at Registry Level
    const handleRegistryEvent = (convId: string, user: TypingUser, isTyping: boolean) => {
        const entry = channelRegistry.get(convId);
        if (!entry) return;

        const exists = entry.typingUsers.some(u => u.id === user.id);

        // Logic for timers/state
        if (!isTyping) {
            // STOP
            if (exists) {
                const timer = entry.timers.get(user.id);
                if (timer) clearTimeout(timer);
                entry.timers.delete(user.id);

                entry.typingUsers = entry.typingUsers.filter(u => u.id !== user.id);
                notifyListeners(entry);
            }
        } else {
            // START
            const existingTimer = entry.timers.get(user.id);
            if (existingTimer) clearTimeout(existingTimer);

            const newTimer = setTimeout(() => {
                const e = channelRegistry.get(convId);
                if (e) {
                    e.typingUsers = e.typingUsers.filter(u => u.id !== user.id);
                    e.timers.delete(user.id);
                    notifyListeners(e);
                }
            }, 3500);

            entry.timers.set(user.id, newTimer);

            if (!exists) {
                entry.typingUsers = [...entry.typingUsers, user];
                notifyListeners(entry);
            }
        }
    };

    const notifyListeners = (entry: ChannelEntry) => {
        entry.listeners.forEach(cb => cb(entry.typingUsers));
    };

    // Send Typing (Uses Registry Channel)
    const sendTyping = useCallback(async (isTyping: boolean) => {
        if (!conversationId || conversationId === 'new') return;

        const entry = channelRegistry.get(conversationId);
        // Note: Even if listen=false, the hook calls register() so an entry exists.
        // However, if listen=false, refCount is incremented.
        // If the channel is not ready?
        // Wait, if options.listen=false, we still create/get the entry and refCount++.
        // So an entry IS guaranteed.

        if (!entry) return;

        const currentUser = await getCurrentUser(supabase);
        if (!currentUser) return;

        const now = Date.now();
        if (isTyping && now - entry.lastSent < 2000) return;

        try {
            await entry.channel.send({
                type: 'broadcast',
                event: 'typing',
                payload: {
                    user: currentUser,
                    isTyping
                }
            });

            if (isTyping) entry.lastSent = now;
            else entry.lastSent = 0;

        } catch (error) {
            // fail silently
        }
    }, [conversationId, supabase]);

    return { typingUsers, sendTyping };
}
