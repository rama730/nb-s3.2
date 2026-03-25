'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { subscribeUserNotifications, type UserNotificationEvent } from '@/lib/realtime/subscriptions';

interface RealtimeContextType {
    isConnected: boolean;
    subscribeUserNotifications: (listener: (event: UserNotificationEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType>({
    isConnected: false,
    subscribeUserNotifications: () => () => { },
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, refreshProfile } = useAuthContext();
    const [isConnected, setIsConnected] = useState(false);
    const listenersRef = useRef(new Set<(event: UserNotificationEvent) => void>());

    const handleUserNotification = useCallback((event: UserNotificationEvent) => {
        if (event.kind === 'profile') {
            void refreshProfile();
        }

        for (const listener of listenersRef.current) {
            try {
                listener(event);
            } catch (error) {
                console.error('Error in user notification listener', {
                    error,
                    event,
                    listener: listener.name || 'anonymous',
                });
            }
        }
    }, [refreshProfile]);

    const registerUserNotificationListener = useCallback((listener: (event: UserNotificationEvent) => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    useEffect(() => {
        if (!user) {
            setIsConnected(false);
            return;
        }

        const supabase = createClient();
        const userId = user.id;

        const channel = subscribeUserNotifications({
            supabase,
            userId,
            onEvent: handleUserNotification,
            onStatus: (status: REALTIME_SUBSCRIBE_STATES) => {
                setIsConnected(status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
            },
        });

        return () => {
            setIsConnected(false);
            supabase.removeChannel(channel);
        };
    }, [user, handleUserNotification]);

    const value = useMemo(
        () => ({
            isConnected,
            subscribeUserNotifications: registerUserNotificationListener,
        }),
        [isConnected, registerUserNotificationListener],
    );

    return (
        <RealtimeContext.Provider value={value}>
            {children}
        </RealtimeContext.Provider>
    );
}

export function useRealtime() {
    return useContext(RealtimeContext);
}
