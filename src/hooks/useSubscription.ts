import { useEffect, useRef } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseSubscriptionOptions {
    table: string;
    filter?: string;
    event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
    enabled?: boolean;
    onData: (payload: { eventType: string; new: any; old: any }) => void;
}

/**
 * Hook for subscribing to Supabase realtime changes on a table.
 */
export function useSubscription({
    table,
    filter,
    event = '*',
    enabled = true,
    onData,
}: UseSubscriptionOptions) {
    const channelRef = useRef<RealtimeChannel | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const supabase = createSupabaseBrowserClient();
        const channelName = `${table}-${filter || 'all'}-${Date.now()}`;

        const channel = supabase.channel(channelName);

        // Subscribe to postgres changes
        channel.on(
            'postgres_changes' as any, // Type assertion needed for Supabase types
            {
                event,
                schema: 'public',
                table,
                filter,
            },
            (payload: any) => {
                onData({
                    eventType: payload.eventType,
                    new: payload.new,
                    old: payload.old,
                });
            }
        );

        channel.subscribe();
        channelRef.current = channel;

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [table, filter, event, enabled, onData]);

    return channelRef;
}
