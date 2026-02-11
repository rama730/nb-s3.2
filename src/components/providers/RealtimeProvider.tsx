'use client';

import { createContext, useContext, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthContext } from '@/components/providers/AuthProvider';

interface RealtimeContextType {
    isConnected: boolean;
}

const RealtimeContext = createContext<RealtimeContextType>({ isConnected: false });

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, refreshProfile } = useAuthContext();

    useEffect(() => {
        if (!user) return;

        const supabase = createClient();
        const userId = user.id;

        // Keep this provider focused on profile synchronization only.
        // Chat realtime is handled by useChatRealtime inside ChatProvider.
        const channel = supabase.channel(`profile-${userId}`);

        channel.on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'profiles',
                filter: `id=eq.${userId}`
            },
            (payload: any) => {
                console.log('[Realtime] Profile updated:', payload);
                refreshProfile();
            }
        );

        channel.subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, refreshProfile]);

    return (
        <RealtimeContext.Provider value={{ isConnected: true }}>
            {children}
        </RealtimeContext.Provider>
    );
}

export function useRealtime() {
    return useContext(RealtimeContext);
}
