'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useAuthContext } from '@/components/providers/AuthProvider';
import {
    isRealtimeTerminalStatus,
    subscribeUserNotifications,
    type UserNotificationEvent,
} from '@/lib/realtime/subscriptions';

interface RealtimeContextType {
    isConnected: boolean;
    subscribeUserNotifications: (listener: (event: UserNotificationEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType>({
    isConnected: false,
    subscribeUserNotifications: () => () => { },
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, session, isLoading, refreshProfile } = useAuthContext();
    const [isConnected, setIsConnected] = useState(false);
    const listenersRef = useRef(new Set<(event: UserNotificationEvent) => void>());
    const connectionTokenRef = useRef(0);

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
        if (!user || !session?.access_token || isLoading) {
            connectionTokenRef.current += 1;
            setIsConnected(false);
            return;
        }

        const supabase = createClient();
        const userId = user.id;
        const connectionToken = connectionTokenRef.current + 1;
        connectionTokenRef.current = connectionToken;
        let cancelled = false;
        let channel: ReturnType<typeof subscribeUserNotifications> | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectAttempt = 0;
        const MAX_BACKOFF_MS = 30_000;

        const connect = async () => {
            if (cancelled || connectionTokenRef.current !== connectionToken) return;

            // Clean up previous channel if reconnecting
            if (channel) {
                supabase.removeChannel(channel);
                channel = null;
            }

            await supabase.realtime.setAuth(session.access_token);
            if (cancelled || connectionTokenRef.current !== connectionToken) {
                return;
            }

            channel = subscribeUserNotifications({
                supabase,
                userId,
                onEvent: handleUserNotification,
                onStatus: (status: REALTIME_SUBSCRIBE_STATES) => {
                    if (connectionTokenRef.current !== connectionToken) {
                        return;
                    }

                    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                        setIsConnected(true);
                        reconnectAttempt = 0; // Reset backoff on successful connection
                        return;
                    }

                    if (isRealtimeTerminalStatus(status)) {
                        setIsConnected(false);
                        // Schedule reconnection with exponential backoff
                        if (!cancelled && connectionTokenRef.current === connectionToken) {
                            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_BACKOFF_MS);
                            reconnectAttempt += 1;
                            reconnectTimer = setTimeout(() => {
                                void connect();
                            }, delay);
                        }
                    }
                },
            });
        };

        void connect().catch((error) => {
            console.error('[realtime] failed to initialize authenticated notifications', error);
            if (connectionTokenRef.current === connectionToken) {
                setIsConnected(false);
                // Schedule reconnection on initialization failure too
                if (!cancelled) {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_BACKOFF_MS);
                    reconnectAttempt += 1;
                    reconnectTimer = setTimeout(() => {
                        void connect();
                    }, delay);
                }
            }
        });

        return () => {
            cancelled = true;
            connectionTokenRef.current += 1;
            setIsConnected(false);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [handleUserNotification, isLoading, session?.access_token, user]);

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
