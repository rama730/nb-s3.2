'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMessagesV2OutboxSync } from '@/hooks/useMessagesV2OutboxSync';
import { usePublishOnlinePresence } from '@/hooks/usePublishOnlinePresence';

interface ChatProviderProps {
    children?: React.ReactNode;
    presenceEnabled?: boolean;
}

const CHAT_IDLE_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 4 * 60_000;
const INITIAL_HEARTBEAT_COOLDOWN_MS = 60_000;
let lastSuccessfulHeartbeatAt = 0;
let heartbeatInFlight = false;

function OnlinePresencePublisher() {
    usePublishOnlinePresence();
    return null;
}

export function ChatProvider({ children = null, presenceEnabled = true }: ChatProviderProps) {
    return <ChatProviderInner presenceEnabled={presenceEnabled}>{children}</ChatProviderInner>;
}

function ChatProviderInner({ children = null, presenceEnabled = true }: ChatProviderProps) {
    const { user, isLoading } = useAuth();
    const active = Boolean(user) && !isLoading;
    const presenceActive = active && presenceEnabled;
    const [engaged, setEngaged] = useState(() => typeof document === 'undefined' || !document.hidden);
    useMessagesV2OutboxSync(active);

    useEffect(() => {
        if (!presenceActive) {
            setEngaged(false);
            return;
        }

        let idleTimer: number | null = null;
        const pause = () => {
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = null;
            setEngaged(false);
        };
        const resume = () => {
            if (document.hidden) return;
            setEngaged(true);
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(pause, CHAT_IDLE_MS);
        };
        const onVisibilityChange = () => document.hidden ? pause() : resume();
        const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'focus'] as const;

        activityEvents.forEach((name) => window.addEventListener(name, resume, { passive: true }));
        document.addEventListener('visibilitychange', onVisibilityChange);
        onVisibilityChange();
        return () => {
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            activityEvents.forEach((name) => window.removeEventListener(name, resume));
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [presenceActive]);

    useEffect(() => {
        if (!presenceActive || !engaged) return;

        const heartbeat = async (initial = false) => {
            if (heartbeatInFlight) return;
            if (initial && Date.now() - lastSuccessfulHeartbeatAt < INITIAL_HEARTBEAT_COOLDOWN_MS) return;
            heartbeatInFlight = true;
            try {
                const response = await fetch('/api/v1/presence/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    keepalive: true,
                });
                if (response.ok) lastSuccessfulHeartbeatAt = Date.now();
            } finally {
                heartbeatInFlight = false;
            }
        };

        void heartbeat(true);
        const interval = window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [engaged, presenceActive, user?.id]);

    return (
        <>
            {children}
            {presenceActive && engaged ? <OnlinePresencePublisher /> : null}
        </>
    );
}
