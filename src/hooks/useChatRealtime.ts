'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useChatStore } from '@/stores/chatStore';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// REALTIME CHAT HOOK - FINAL OPTIMIZED ARCHITECTURE
// Pure Performance | Zero Redundancy | Robust State Sync
// ============================================================================

export function useChatRealtime(userId: string | null) {
    const channelRef = useRef<RealtimeChannel | null>(null);

    // Store Selectors (Stable references)
    const setConnected = useChatStore(state => state.setConnected);
    const _handleNewMessage = useChatStore(state => state._handleNewMessage);
    const checkActiveConnectionStatus = useChatStore(state => state.checkActiveConnectionStatus);
    // ------------------------------------------------------------------------
    // Main Subscription Effect
    // ------------------------------------------------------------------------
    useEffect(() => {
        if (!userId) {
            setConnected(false);
            return;
        }

        const supabase = createClient();
        console.log('[REALTIME] Initializing Optimized Connection...');

        const channel = supabase.channel(`user-${userId}`)
            // 1. Messaging
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => _handleNewMessage(payload.new)
            )
            // 2. Connection Status
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'connections', filter: `requester_id=eq.${userId}` },
                () => checkActiveConnectionStatus()
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'connections', filter: `addressee_id=eq.${userId}` },
                () => checkActiveConnectionStatus()
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') setConnected(true);
                else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnected(false);
            });

        channelRef.current = channel;

        // Cleanup
        return () => {
            setConnected(false);
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [userId, setConnected, _handleNewMessage, checkActiveConnectionStatus]);

    return null;
}
