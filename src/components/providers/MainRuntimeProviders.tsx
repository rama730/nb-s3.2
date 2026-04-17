'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { PeopleNotificationsProvider } from '@/components/providers/PeopleNotificationsProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from '@/hooks/usePresenceStatus';
import { usePublishOnlinePresence } from '@/hooks/usePublishOnlinePresence';

const LazyChatProvider = dynamic(
  () => import('@/components/chat/ChatProvider').then((mod) => mod.ChatProvider),
  { ssr: false },
);

interface MainRuntimeProvidersProps {
  children: React.ReactNode;
  initialUser: User | null;
  initialProfile: unknown | null;
}

function PresencePublisher() {
  usePublishOnlinePresence();
  return null;
}

export function MainRuntimeProviders({
  children,
  initialUser,
  initialProfile,
}: MainRuntimeProvidersProps) {
  const [enableChatRuntime, setEnableChatRuntime] = useState(false);

  // Start presence heartbeat when user is authenticated
  useEffect(() => {
    if (!initialUser) return;
    startPresenceHeartbeat();
    return () => stopPresenceHeartbeat();
  }, [initialUser]);

  useEffect(() => {
    let cancelled = false;
    const activate = () => {
      if (!cancelled) setEnableChatRuntime(true);
    };

    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(activate);
      return () => {
        cancelled = true;
        const cancelIdle =
          (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (typeof cancelIdle === 'function') cancelIdle(id);
      };
    }

    const timer = window.setTimeout(activate, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <AuthProvider initialUser={initialUser} initialProfile={initialProfile}>
      <PresencePublisher />
      <RealtimeProvider>
        <PeopleNotificationsProvider>
          {children}
          {enableChatRuntime ? <LazyChatProvider /> : null}
        </PeopleNotificationsProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
