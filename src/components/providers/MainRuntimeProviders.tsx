'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/lib/db/schema';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';

const LazyChatProvider = dynamic(
  () => import('@/components/chat/ChatProvider').then((mod) => mod.ChatProvider),
  { ssr: false },
);

interface MainRuntimeProvidersProps {
  children: React.ReactNode;
  initialUser: User | null;
  initialProfile: Profile | null;
}

export function MainRuntimeProviders({
  children,
  initialUser,
  initialProfile,
}: MainRuntimeProvidersProps) {
  const [enableChatRuntime, setEnableChatRuntime] = useState(false);

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
      <RealtimeProvider>
        {children}
        {enableChatRuntime ? <LazyChatProvider /> : null}
      </RealtimeProvider>
    </AuthProvider>
  );
}
