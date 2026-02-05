'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatStore, selectActiveDraft } from '@/stores/chatStore';
import { useTypingChannel } from '@/hooks/useTypingChannel';
import { uploadAttachment, sendMessageWithAttachments, type UploadedAttachment } from '@/app/actions/messaging';
import { checkConnectionStatus, acceptConnectionRequest } from '@/app/actions/connections';
import { acceptApplicationAction, rejectApplicationAction } from '@/app/actions/applications';
import { Send, Paperclip, Image, X, Loader2, UserPlus, Clock, Check } from 'lucide-react';
import { toast } from 'sonner';
import { ChatApplicationBanner } from './ChatApplicationBanner';

// ============================================================================
// MESSAGE INPUT
// Text input with attachment support and typing indicator
// ============================================================================

interface MessageInputProps {
    conversationId: string;
    targetUserId?: string;
}

interface PendingAttachment {
    file: File;
    preview?: string;
    uploading: boolean;
    uploaded?: UploadedAttachment;
    error?: string;
}

export function MessageInput({ conversationId, targetUserId }: MessageInputProps) {
    const draft = useChatStore(state => state.draftsByConversation[conversationId] || '');
    const setDraft = useChatStore(state => state.setDraft);
    const sendMessage = useChatStore(state => state.sendMessage); // Store version
    const [isSending, setIsSending] = useState(false);
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Typing indicator - Scalable Broadcast
    const { sendTyping } = useTypingChannel(conversationId !== 'new' ? conversationId : null, { listen: false });

    // Handle input change
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(conversationId, e.target.value);
        if (conversationId !== 'new') {
            sendTyping(true);
        }

        // Auto-resize textarea
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [conversationId, setDraft, sendTyping]);

    // Upload a single file
    const uploadFile = async (file: File, index: number) => {
        setAttachments(prev => prev.map((att, i) =>
            i === index ? { ...att, uploading: true, error: undefined } : att
        ));

        const formData = new FormData();
        formData.append('file', file);

        const result = await uploadAttachment(formData);

        setAttachments(prev => prev.map((att, i) =>
            i === index
                ? {
                    ...att,
                    uploading: false,
                    uploaded: result.attachment,
                    error: result.error
                }
                : att
        ));

        if (result.error) {
            toast.error(`Failed to upload ${file.name}: ${result.error}`);
        }
    };

    // Handle file selection
    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        // Limit to 5 attachments total
        const availableSlots = 5 - attachments.length;
        const filesToAdd = files.slice(0, availableSlots);

        if (files.length > availableSlots) {
            toast.warning(`Maximum 5 attachments. Only ${availableSlots} files added.`);
        }

        // Create pending attachments with previews
        const newAttachments: PendingAttachment[] = filesToAdd.map(file => ({
            file,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
            uploading: true,
        }));

        const startIndex = attachments.length;
        setAttachments(prev => [...prev, ...newAttachments]);

        // Upload each file in parallel
        await Promise.all(
            filesToAdd.map((file, i) => uploadFile(file, startIndex + i))
        );

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [attachments.length]);

    // Remove attachment
    const removeAttachment = useCallback((index: number) => {
        setAttachments(prev => {
            const att = prev[index];
            // Revoke blob URL to free memory
            if (att.preview) {
                URL.revokeObjectURL(att.preview);
            }
            return prev.filter((_, i) => i !== index);
        });
    }, []);

    // Handle send
    const handleSend = useCallback(async () => {
        const text = draft.trim();
        const uploadedAttachments = attachments
            .filter(att => att.uploaded && !att.error)
            .map(att => att.uploaded!);

        if (!text && uploadedAttachments.length === 0) return;
        if (isSending) return;

        // Check if any attachments are still uploading
        if (attachments.some(att => att.uploading)) {
            toast.info('Please wait for attachments to finish uploading');
            return;
        }

        setIsSending(true);
        if (conversationId !== 'new') {
            sendTyping(false);
        }

        try {
            let actualConversationId = conversationId;

            // IF THIS IS A NEW CHAT -> CREATE IT FIRST
            if (conversationId === 'new') {
                if (!targetUserId) {
                    toast.error("Cannot start chat without a user");
                    setIsSending(false);
                    return;
                }
                
                // Import dynamically to avoid circle dep if possible, or just use the imported action
                const { getOrCreateDMConversation } = await import('@/app/actions/messaging');
                const result = await getOrCreateDMConversation(targetUserId);
                
                if (!result.success || !result.conversationId) {
                    toast.error(result.error || "Failed to start conversation");
                    setIsSending(false);
                    return;
                }
                actualConversationId = result.conversationId;
            }

            let success = false;
            // Native import for action to ensure we use the explicit ID (Store's sendMessage might use state ID)
            const { sendMessage, sendMessageWithAttachments } = await import('@/app/actions/messaging');

            if (uploadedAttachments.length > 0) {
                const result = await sendMessageWithAttachments(
                    actualConversationId,
                    text,
                    uploadedAttachments
                );
                success = result.success;
                if (!result.success) toast.error(result.error || 'Failed to send message');
            } else {
                const result = await sendMessage(actualConversationId, text);
                success = result.success;
                if (!result.success) toast.error(result.error || 'Failed to send message');
            }

            if (success) {
                // Clear attachments
                attachments.forEach(att => {
                    if (att.preview) URL.revokeObjectURL(att.preview);
                });
                setAttachments([]);
                setDraft(conversationId, ''); // Clear draft for the "old" ID (new or existing)
                
                if (inputRef.current) {
                    inputRef.current.style.height = 'auto';
                }

                // If we created a new chat, we MUST redirect to the real URL now
                if (conversationId === 'new') {
                     // Force hard redirect or router push to the new ID
                     window.history.pushState(null, '', `/messages?conversationId=${actualConversationId}`);
                     window.location.href = `/messages?conversationId=${actualConversationId}`;
                }
            }
        } catch (e) {
            console.error(e);
            toast.error("Error sending message");
        } finally {
            setIsSending(false);
        }

        // Focus back on input
        inputRef.current?.focus();
    }, [conversationId, targetUserId, draft, attachments, isSending, sendTyping, setDraft]);

    // Handle key press
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const hasUploadingAttachments = attachments.some(att => att.uploading);
    const hasValidAttachments = attachments.some(att => att.uploaded && !att.error);

    const connectionStatus = useChatStore(state => state.activeConnectionStatus);
    const isIncomingConnectionRequest = useChatStore(state => state.isIncomingConnectionRequest);
    const isPendingSent = useChatStore(state => state.isPendingSent);
    const hasActiveApplication = useChatStore(state => state.hasActiveApplication);
    const isApplicant = useChatStore(state => state.isApplicant);
    const isCreator = useChatStore(state => state.isCreator);
    const activeApplicationId = useChatStore(state => state.activeApplicationId);
    const activeApplicationStatus = useChatStore(state => state.activeApplicationStatus);
    const activeProjectId = useChatStore(state => state.activeProjectId);

    const sendConnectionRequest = useChatStore(state => state.sendConnectionRequest);
    const [requestLoading, setRequestLoading] = useState(false);
    
    // Check connection status for new chats
    useEffect(() => {
        if (conversationId === 'new' && targetUserId) {
            useChatStore.setState({ activeConnectionStatus: 'loading' });
            checkConnectionStatus(targetUserId).then(result => {
                if (result.success && result.status) {
                    useChatStore.setState({ activeConnectionStatus: result.status });
                } else {
                    useChatStore.setState({ activeConnectionStatus: 'none' });
                }
            }).catch(() => {
                 useChatStore.setState({ activeConnectionStatus: 'none' });
            });
        }
    }, [conversationId, targetUserId]);

    const handleConnect = async () => {
        setRequestLoading(true);
        try {
            await sendConnectionRequest();
            toast.success('Connection request sent');
        } catch (error) {
            toast.error('Failed to send request');
        } finally {
            setRequestLoading(false);
        }
    };
    
    const handleAccept = async () => {
        if (!targetUserId && conversationId === 'new') return;
        
        setRequestLoading(true);
        try {
            // We need connectionId. We fetch it first.
             // If we are in "new" mode, we have targetUserId.
            // If we are in existing mode, we need to extract userId from participants or just use the store logic to get it?
            // "checkConnectionStatus" handles finding the relevant connection record.
            
            let userIdToCheck = targetUserId;
            if (!userIdToCheck && conversationId !== 'new') {
                // If existing conversation, we can try to find the other user from store.. 
                // But honestly, it's safer to reliance on checkConnectionStatus to just find the connection record for the "other" user
                // The store might be easier.
                // However, checkConnectionStatus needs userId. 
                // Let's assume for now targetUserId is passed or we can't easily get it here without selectors.
                // Actually MessageInput receives targetUserId!
            }
            
            if (!userIdToCheck) {
                // Try getting from store if not props
                 const state = useChatStore.getState();
                 if (state.activeConversationId === conversationId) {
                      const conv = state.conversations.find(c => c.id === conversationId);
                       if (conv && conv.type === 'dm') userIdToCheck = conv.participants[0]?.id;
                 }
            }

            if (!userIdToCheck) throw new Error("Cannot identify user");

            // 1. Get connection ID
            const statusRes = await checkConnectionStatus(userIdToCheck);
            if (!statusRes.success || !statusRes.connectionId) throw new Error("Connection not found");
            
            // 2. Accept
            const result = await acceptConnectionRequest(statusRes.connectionId);
            if (result.success) {
                toast.success('Connection accepted');
                useChatStore.setState({ activeConnectionStatus: 'connected' });
                 // Refresh conversations to update any status indicators
                useChatStore.getState().refreshConversations();
            } else {
                toast.error(result.error || 'Failed to accept');
            }
        } catch (error) {
            console.error(error);
            toast.error('Failed to accept connection');
        } finally {
            setRequestLoading(false);
        }
    };

    // If loading status, show loader
    if (connectionStatus === 'loading') {
        return (
            <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 flex justify-center items-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
        );
    }

    // If not connected, show Connect UI (unless it's a new conversation or group)
    // We assume 'none' means strictly DM not connected. Groups don't set this status to 'none'.
    if (connectionStatus === 'none') {
        return (
            <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
                <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-3">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        You are not connected with this user.
                    </p>
                    <button
                        onClick={handleConnect}
                        disabled={requestLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {requestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        Connect
                    </button>
                    <p className="text-xs text-zinc-400">
                        Connect to start messaging
                    </p>
                </div>
            </div>
        );
    }

    // If pending request (sent)
    if (connectionStatus === 'pending_sent') {
        return (
            <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
                <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2">
                    <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-1">
                        <Clock className="w-5 h-5 text-zinc-400" />
                    </div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Connection Request Sent
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Waiting for user to accept your request
                    </p>
                </div>
            </div>
        );
    }

    // If pending request (received) - BUT we want to allow messaging (status='open' + isIncomingRequest)
    // The store now returns 'open' for incoming requests, so we just check for the flag to show the banner.
    // We only block if status is strictly 'pending_received' (legacy) or if we want to force accept.
    // But our new logic returns 'open' for incoming.

    return (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
            
            {/* Application Active Banner */}
            {hasActiveApplication && activeApplicationId && (
                <ChatApplicationBanner 
                    isApplicant={isApplicant}
                    isCreator={isCreator}
                    activeApplicationId={activeApplicationId}
                    activeApplicationStatus={activeApplicationStatus}
                    activeProjectId={activeProjectId}
                />
            )}

            <div className="p-3">
             {/* Incoming Request Banner (Recipient) */}
            {isIncomingConnectionRequest && (
                <div className="mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900 rounded-lg p-3 flex items-center justify-between">
                    <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                        <UserPlus className="w-4 h-4" />
                        <span>This user sent you a connection request</span>
                    </p>
                    <button
                        onClick={handleAccept}
                        disabled={requestLoading}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {requestLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Accept
                    </button>
                </div>
            )}

            {/* Pending Request Banner (Sender) */}
            {isPendingSent && (
                <div className="mb-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 flex items-center justify-center">
                     <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span>Connection request pending</span>
                    </p>
                </div>
            )}

            {/* Attachment previews */}
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {attachments.map((att, index) => (
                        <div
                            key={index}
                            className={`relative group flex items-center gap-2 px-3 py-2 rounded-lg ${att.error
                                    ? 'bg-red-100 dark:bg-red-900/30'
                                    : 'bg-zinc-100 dark:bg-zinc-800'
                                }`}
                        >
                            {att.uploading ? (
                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                            ) : att.file.type.startsWith('image/') ? (
                                att.preview ? (
                                    <img
                                        src={att.preview}
                                        alt={att.file.name}
                                        className="w-8 h-8 rounded object-cover"
                                    />
                                ) : (
                                    <Image className="w-4 h-4 text-blue-500" />
                                )
                            ) : (
                                <Paperclip className="w-4 h-4 text-zinc-500" />
                            )}
                            <span className={`text-xs max-w-[100px] truncate ${att.error
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-zinc-600 dark:text-zinc-300'
                                }`}>
                                {att.file.name}
                            </span>
                            {att.uploaded && (
                                <span className="text-xs text-green-500">✓</span>
                            )}
                            <button
                                onClick={() => removeAttachment(index)}
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="w-3 h-3 text-white" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Input row */}
            <div className="flex items-end gap-2">
                {/* Attachment button */}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachments.length >= 5}
                    className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
                    title="Attach file"
                >
                    <Paperclip className="w-5 h-5" />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                {/* Text input */}
                <div className="flex-1 relative">
                    <textarea
                        ref={inputRef}
                        value={draft}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message..."
                        rows={1}
                        className="w-full px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 max-h-[120px]"
                        style={{ minHeight: '42px' }}
                    />
                </div>

                {/* Send button */}
                <button
                    onClick={handleSend}
                    disabled={isSending || hasUploadingAttachments || (!draft.trim() && !hasValidAttachments)}
                    className="p-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all hover:scale-105 disabled:hover:scale-100"
                >
                    {isSending || hasUploadingAttachments ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Send className="w-5 h-5" />
                    )}
                </button>
            </div>
            </div>
        </div>
    );
}
