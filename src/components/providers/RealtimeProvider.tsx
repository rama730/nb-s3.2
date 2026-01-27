'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useChatStore } from '@/stores/chatStore';
import { RealtimeChannel } from '@supabase/supabase-js';

interface RealtimeContextType {
    isConnected: boolean;
}

const RealtimeContext = createContext<RealtimeContextType>({ isConnected: false });

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, refreshProfile } = useAuthContext();
    const channelRef = useRef<RealtimeChannel | null>(null);
    
    // Store actions
    const handleNewMessage = useChatStore(state => state._handleNewMessage);
    const refreshConversations = useChatStore(state => state.refreshConversations);
    const setConnected = useChatStore(state => state.setConnected);

    useEffect(() => {
        if (!user) {
            setConnected(false);
            return;
        }

        const supabase = createClient();
        const userId = user.id;

        // Create a single channel for all user-scoped events
        // We can multiplex different listen types on the same channel if we want, 
        // or just use one channel name for clarity.
        // For Supabase "postgres_changes", the channel name doesn't matter strictly for filtering,
        // but it helps debugging.
        const channel = supabase.channel(`user-global-${userId}`);

        // 1. Profile Updates
        channel.on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'profiles',
                filter: `id=eq.${userId}`
            },
            (payload) => {
                console.log('[Realtime] Profile updated:', payload);
                refreshProfile();
                // We could optimise by passing payload, but refreshProfile is safer/cleaner source of truth
            }
        );

        // 2. New Messages (Global Listener for Notifications/Unread)
        // Note: We listen to ALL messages for this user to update badges/toasts anywhere
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
            },
            async (payload) => {
                const newMessage = payload.new as any;
                
                // Skip own messages (handled optimistically or by active chat)
                if (newMessage.sender_id === userId) return;

                // We need to verify if this message belongs to a conversation we are part of
                // ideally the RLS filtering handles this, so we only receive messages we can see.
                // However, 'messages' table might not have direct 'receiver_id' for DMs easily filtered 
                // without joining. 
                // BUT: Supabase Realtime checks RLS. If we have RLS policy "user can see messages in their conversations",
                // we will only get valid messages.
                
                // We need to fetch details to show a nice notification (sender name, etc)
                // The store's _handleNewMessage expects a full object.
                // We'll do a quick fetch of the sender.
                
                const { data: senderProfile } = await supabase
                    .from('profiles')
                    .select('id, username, full_name, avatar_url')
                    .eq('id', newMessage.sender_id)
                    .single();

                // Check for attachments
                const { data: attachments } = await supabase
                    .from('message_attachments')
                    .select('*')
                    .eq('message_id', newMessage.id);

                handleNewMessage({
                    id: newMessage.id,
                    conversationId: newMessage.conversation_id,
                    senderId: newMessage.sender_id,
                    content: newMessage.content,
                    type: newMessage.type,
                    metadata: newMessage.metadata || {},
                    createdAt: new Date(newMessage.created_at),
                    editedAt: newMessage.edited_at ? new Date(newMessage.edited_at) : null,
                    deletedAt: newMessage.deleted_at ? new Date(newMessage.deleted_at) : null,
                    sender: senderProfile ? {
                        id: senderProfile.id,
                        username: senderProfile.username,
                        fullName: senderProfile.full_name,
                        avatarUrl: senderProfile.avatar_url,
                    } : null,
                    attachments: (attachments || []).map((a: any) => ({
                        id: a.id,
                        type: a.type,
                        url: a.url,
                        filename: a.filename,
                        sizeBytes: a.size_bytes,
                        mimeType: a.mime_type,
                        thumbnailUrl: a.thumbnail_url,
                        width: a.width,
                        height: a.height,
                    })),
                });
            }
        );

        // 3. Message Follow-ups (Update/Delete)
        channel.on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages',
            },
            () => {
                refreshConversations();
            }
        );

        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[Realtime] Connected');
                setConnected(true);
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.log('[Realtime] Disconnected:', status);
                setConnected(false, 'Connection lost');
            }
        });

        channelRef.current = channel;

        return () => {
            supabase.removeChannel(channel);
            setConnected(false);
        };
    }, [user, refreshProfile, handleNewMessage, refreshConversations, setConnected]);

    return (
        <RealtimeContext.Provider value={{ isConnected: true }}>
            {children}
        </RealtimeContext.Provider>
    );
}

export function useRealtime() {
    return useContext(RealtimeContext);
}
