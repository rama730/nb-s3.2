'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
    isRealtimeTerminalStatus,
    subscribeMessagingNotifications as subscribeMessagingNotificationsChannel,
    subscribeUserNotifications,
    type MessagingNotificationEvent,
    type UserNotificationEvent,
} from '@/lib/realtime/subscriptions';

export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';
export type RealtimeHealthState = 'healthy' | 'reconnecting' | 'offline' | 'unavailable';

interface RealtimeContextType {
    isConnected: boolean;
    isMessagingConnected: boolean;
    notificationStatus: RealtimeConnectionStatus;
    messagingStatus: RealtimeConnectionStatus;
    connectionHealth: RealtimeHealthState;
    retryRealtime: () => void;
    subscribeUserNotifications: (listener: (event: UserNotificationEvent) => void) => () => void;
    subscribeMessagingNotifications: (listener: (event: MessagingNotificationEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType>({
    isConnected: false,
    isMessagingConnected: false,
    notificationStatus: 'idle',
    messagingStatus: 'idle',
    connectionHealth: 'healthy',
    retryRealtime: () => { },
    subscribeUserNotifications: () => () => { },
    subscribeMessagingNotifications: () => () => { },
});

function hasProfileDetailsChanged(next: Record<string, unknown>, currentProfile: any | null) {
    if (!currentProfile) return true;
    if (next.username !== undefined && next.username !== currentProfile.username) return true;
    if (next.full_name !== undefined && next.full_name !== currentProfile.fullName) return true;
    if (next.avatar_url !== undefined && next.avatar_url !== currentProfile.avatarUrl) return true;
    return false;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, session, isLoading, refreshProfile, profile } = useAuthContext();
    const isOnline = useOnlineStatus();
    const [notificationStatus, setNotificationStatus] = useState<RealtimeConnectionStatus>('idle');
    const [messagingStatus, setMessagingStatus] = useState<RealtimeConnectionStatus>('idle');
    const [reconnectNonce, setReconnectNonce] = useState(0);
    const [connectionHealth, setConnectionHealth] = useState<RealtimeHealthState>('healthy');
    const listenersRef = useRef(new Set<(event: UserNotificationEvent) => void>());
    const messagingListenersRef = useRef(new Set<(event: MessagingNotificationEvent) => void>());
    const connectionTokenRef = useRef(0);
    const messagingConnectionTokenRef = useRef(0);
    const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wasOnlineRef = useRef(isOnline);

    const profileRef = useRef(profile);
    const refreshProfileRef = useRef(refreshProfile);

    useEffect(() => {
        profileRef.current = profile;
        refreshProfileRef.current = refreshProfile;
    }, [profile, refreshProfile]);

    const handleUserNotification = useCallback((event: UserNotificationEvent) => {
        if (event.kind === 'profile') {
            const next = (event.payload.new ?? {}) as Record<string, unknown>;
            if (hasProfileDetailsChanged(next, profileRef.current)) {
                void refreshProfileRef.current();
            }
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
    }, []);

    const registerUserNotificationListener = useCallback((listener: (event: UserNotificationEvent) => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    const handleMessagingNotification = useCallback((event: MessagingNotificationEvent) => {
        for (const listener of messagingListenersRef.current) {
            try {
                listener(event);
            } catch (error) {
                console.error('Error in messaging notification listener', {
                    error,
                    event,
                    listener: listener.name || 'anonymous',
                });
            }
        }
    }, []);

    const registerMessagingNotificationListener = useCallback((listener: (event: MessagingNotificationEvent) => void) => {
        messagingListenersRef.current.add(listener);
        return () => {
            messagingListenersRef.current.delete(listener);
        };
    }, []);

    const retryRealtime = useCallback(() => {
        if (!navigator.onLine) return;
        setReconnectNonce((current) => current + 1);
    }, []);

    // The browser "online" event is the one reliable signal that a fresh
    // transport attempt is useful. It avoids background health polling while
    // still recovering promptly after an actual network interruption.
    useEffect(() => {
        if (isOnline && !wasOnlineRef.current && user) {
            setReconnectNonce((current) => current + 1);
        }
        wasOnlineRef.current = isOnline;
    }, [isOnline, user?.id]);

    // A connection warning should describe transport health, not a business
    // notification count. Brief channel churn is normal, so wait before
    // surfacing it and clear the warning as soon as both channels recover.
    useEffect(() => {
        if (healthTimerRef.current) {
            clearTimeout(healthTimerRef.current);
            healthTimerRef.current = null;
        }

        if (!user || isLoading || !session?.access_token) {
            setConnectionHealth('healthy');
            return;
        }

        if (!isOnline) {
            setConnectionHealth('offline');
            return;
        }

        const bothConnected = notificationStatus === 'connected' && messagingStatus === 'connected';
        if (bothConnected) {
            setConnectionHealth('healthy');
            return;
        }

        const nextState: RealtimeHealthState =
            notificationStatus === 'disconnected' && messagingStatus === 'disconnected'
                ? 'unavailable'
                : 'reconnecting';

        healthTimerRef.current = setTimeout(() => {
            setConnectionHealth(nextState);
            healthTimerRef.current = null;
        }, 3_000);

        return () => {
            if (healthTimerRef.current) {
                clearTimeout(healthTimerRef.current);
                healthTimerRef.current = null;
            }
        };
    }, [isLoading, isOnline, messagingStatus, notificationStatus, session?.access_token, user?.id]);

    useEffect(() => {
        if (!user) {
            connectionTokenRef.current += 1;
            setNotificationStatus('idle');
            return;
        }
        if (!session?.access_token || isLoading) {
            connectionTokenRef.current += 1;
            setNotificationStatus('connecting');
            return;
        }

        const supabase = createClient();
        const userId = user.id;
        const connectionToken = connectionTokenRef.current + 1;
        connectionTokenRef.current = connectionToken;
        setNotificationStatus('connecting');
        let cancelled = false;
        let channel: ReturnType<typeof subscribeUserNotifications> | null = null;

        const connect = async () => {
            if (cancelled || connectionTokenRef.current !== connectionToken) return;

            await supabase.realtime.setAuth(session.access_token);
            if (cancelled || connectionTokenRef.current !== connectionToken) {
                return;
            }

            channel = subscribeUserNotifications({
                supabase,
                userId,
                onEvent: handleUserNotification,
                onStatus: (status: REALTIME_SUBSCRIBE_STATES) => {
                    if (connectionTokenRef.current !== connectionToken) return;

                    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                        setNotificationStatus('connected');
                        return;
                    }

                    if (isRealtimeTerminalStatus(status)) {
                        setNotificationStatus('disconnected');
                    }
                },
            });
        };

        void connect().catch((error) => {
            console.error('[realtime] failed to initialize authenticated notifications', error);
            if (connectionTokenRef.current === connectionToken) {
                setNotificationStatus('disconnected');
            }
        });

        return () => {
            cancelled = true;
            connectionTokenRef.current += 1;
            if (channel) {
                void supabase.removeChannel(channel);
            }
        };
    }, [handleUserNotification, isLoading, reconnectNonce, session?.access_token, user?.id]);

    useEffect(() => {
        if (!user) {
            messagingConnectionTokenRef.current += 1;
            setMessagingStatus('idle');
            return;
        }
        if (!session?.access_token || isLoading) {
            messagingConnectionTokenRef.current += 1;
            setMessagingStatus('connecting');
            return;
        }

        const supabase = createClient();
        const userId = user.id;
        const connectionToken = messagingConnectionTokenRef.current + 1;
        messagingConnectionTokenRef.current = connectionToken;
        setMessagingStatus('connecting');
        let cancelled = false;
        let channel: ReturnType<typeof subscribeMessagingNotificationsChannel> | null = null;

        const connect = async () => {
            if (cancelled || messagingConnectionTokenRef.current !== connectionToken) return;

            await supabase.realtime.setAuth(session.access_token);
            if (cancelled || messagingConnectionTokenRef.current !== connectionToken) return;

            const nextChannel = subscribeMessagingNotificationsChannel({
                supabase,
                userId,
                onEvent: handleMessagingNotification,
                onStatus: (status) => {
                    if (messagingConnectionTokenRef.current !== connectionToken) return;
                    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                        setMessagingStatus('connected');
                        return;
                    }
                    if (isRealtimeTerminalStatus(status)) {
                        setMessagingStatus('disconnected');
                    }
                },
            });
            channel = nextChannel;
        };

        void connect().catch((error) => {
            console.error('[realtime] failed to initialize messaging notifications', error);
            if (messagingConnectionTokenRef.current !== connectionToken) return;
            setMessagingStatus('disconnected');
        });

        return () => {
            cancelled = true;
            messagingConnectionTokenRef.current += 1;
            if (channel) void supabase.removeChannel(channel);
        };
    }, [handleMessagingNotification, isLoading, reconnectNonce, session?.access_token, user?.id]);

    const isConnected = notificationStatus === 'connected';
    const isMessagingConnected = messagingStatus === 'connected';
    const value = useMemo(
        () => ({
            isConnected,
            isMessagingConnected,
            notificationStatus,
            messagingStatus,
            connectionHealth,
            retryRealtime,
            subscribeUserNotifications: registerUserNotificationListener,
            subscribeMessagingNotifications: registerMessagingNotificationListener,
        }),
        [
            isConnected,
            isMessagingConnected,
            messagingStatus,
            notificationStatus,
            connectionHealth,
            registerMessagingNotificationListener,
            registerUserNotificationListener,
            retryRealtime,
        ],
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
