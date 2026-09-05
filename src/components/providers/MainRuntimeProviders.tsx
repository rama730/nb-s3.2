'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { PeopleNotificationsProvider } from '@/components/providers/PeopleNotificationsProvider';
import { MessageAttentionProvider } from '@/components/providers/MessageAttentionProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';
import { ChatPopupV2 } from '@/components/chat/v2/ChatPopupV2';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';

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
  const pathname = usePathname();
  const isMessagesRoute = pathname?.startsWith('/messages') ?? false;
  const popupOpen = useMessagesV2UiStore((state) => state.popupState === 'open');

  return (
    <>
      <RealtimeProvider>
        <PeopleNotificationsProvider>
          <MessageAttentionProvider>
            {children}
            <ChatPopupV2 />
            <LazyChatProvider presenceEnabled={true} />
          </MessageAttentionProvider>
        </PeopleNotificationsProvider>
      </RealtimeProvider>
    </>
  );
}
