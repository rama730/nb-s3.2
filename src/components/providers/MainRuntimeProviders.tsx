'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { PeopleNotificationsProvider } from '@/components/providers/PeopleNotificationsProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';

const LazyChatProvider = dynamic(
  () => import('@/components/chat/ChatProvider').then((mod) => mod.ChatProvider),
  { ssr: false },
);

interface MainRuntimeProvidersProps {
  children: React.ReactNode;
}

export function MainRuntimeProviders({
  children,
}: MainRuntimeProvidersProps) {
  return (
    <>
      <RealtimeProvider>
        <PeopleNotificationsProvider>
          {children}
          <LazyChatProvider />
        </PeopleNotificationsProvider>
      </RealtimeProvider>
    </>
  );
}
