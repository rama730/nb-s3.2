'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Loader2, UserPlus, MessageSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import {
    searchMessageRecipientsV2,
    type MessageRecipientV2,
} from '@/app/actions/messaging/v2';
import { toast } from 'sonner';
import { useEnsureDirectConversation } from '@/hooks/useMessagesV2';
import { logger } from '@/lib/logger';
import { upsertInboxConversation } from '@/lib/messages/v2-cache';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import { cn } from '@/lib/utils';

interface NewMessageModalV2Props {
    isOpen: boolean;
    onClose: () => void;
    onConversationOpened: (conversationId: string) => void;
}

export function NewMessageModalV2({
    isOpen,
    onClose,
    onConversationOpened,
}: NewMessageModalV2Props) {
    const queryClient = useQueryClient();
    const ensureConversation = useEnsureDirectConversation();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MessageRecipientV2[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [openingUserId, setOpeningUserId] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [debouncedQuery] = useDebounce(query, Array.from(query.trim()).length < 4 ? 450 : 250);
    const requestTokenRef = useRef(0);
    const openGenerationRef = useRef(0);
    const cursorRef = useRef<string | null>(null);

    const loadConnections = useCallback(async (opts?: { append?: boolean; search?: string }) => {
        const append = Boolean(opts?.append);
        const search = (opts?.search ?? debouncedQuery).trim();
        const requestToken = ++requestTokenRef.current;

        if (append) setIsLoadingMore(true);
        else {
            setIsSearching(true);
            setSearchError(null);
        }

        try {
            const response = await searchMessageRecipientsV2({
                limit: 30,
                cursor: append ? cursorRef.current || undefined : undefined,
                query: search || undefined,
            });
            if (!response.success) {
                throw new Error(response.error || 'Unable to search recipients');
            }

            if (requestToken !== requestTokenRef.current) return;

            setHasMore(Boolean(response.hasMore));
            const nextCursor = response.nextCursor || null;
            cursorRef.current = nextCursor;

            if (append) {
                setResults((prev) => {
                    const seen = new Set(prev.map((item) => item.userId));
                    const merged = [...prev];
                    for (const item of response.recipients) {
                        if (seen.has(item.userId)) continue;
                        seen.add(item.userId);
                        merged.push(item);
                    }
                    return merged;
                });
            } else {
                setResults(response.recipients);
            }
        } catch (error) {
            logger.error('[messages-v2] failed to load accepted connections', {
                module: 'messages',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            if (requestToken === requestTokenRef.current) {
                setSearchError(error instanceof Error ? error.message : 'Unable to search recipients');
            }
        } finally {
            if (requestToken === requestTokenRef.current) {
                setIsSearching(false);
                setIsLoadingMore(false);
            }
        }
    }, [debouncedQuery]);

    useEffect(() => {
        if (!isOpen) return;
        void loadConnections({ append: false, search: debouncedQuery });
    }, [debouncedQuery, isOpen, loadConnections]);

    useEffect(() => {
        if (isOpen) return;
        setQuery('');
        setResults([]);
        cursorRef.current = null;
        setHasMore(false);
        setIsSearching(false);
        setIsLoadingMore(false);
        requestTokenRef.current += 1;
        openGenerationRef.current += 1;
        setSearchError(null);
        setOpeningUserId(null);
        setActiveIndex(0);
    }, [isOpen]);

    const loadMore = async () => {
        if (!hasMore || isLoadingMore || isSearching) return;
        await loadConnections({ append: true, search: debouncedQuery });
    };

    const closeModal = () => {
        openGenerationRef.current += 1;
        requestTokenRef.current += 1;
        onClose();
    };

    const handleSelectUser = async (userId: string) => {
        if (openingUserId) return;
        const generation = openGenerationRef.current;
        setOpeningUserId(userId);
        try {
            const result = await ensureConversation.mutateAsync(userId);
            if (generation !== openGenerationRef.current) return;
            if (!result.conversationId) {
                toast.error('Failed to open conversation');
                return;
            }
            // For draft conversations, seed the thread cache so the UI renders correctly
            if (result.conversationId.startsWith('draft:') && result.conversation) {
                queryClient.setQueryData(
                    ['chat-v2', 'thread', result.conversationId],
                    {
                        pages: [{
                            conversation: result.conversation,
                            capability: result.conversation.capability,
                            messages: [],
                            pinnedMessages: [],
                            hasMore: false,
                            nextCursor: null,
                        }],
                        pageParams: [undefined],
                    },
                );
            } else if (result.conversation) {
                upsertInboxConversation(queryClient, result.conversation!);
            }
            onConversationOpened(result.conversationId);
            closeModal();
        } catch (error) {
            if (generation !== openGenerationRef.current) return;
            toast.error(error instanceof Error ? error.message : 'Failed to open conversation');
        } finally {
            if (generation === openGenerationRef.current) setOpeningUserId(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
            <DialogContent className="gap-0 overflow-hidden border-zinc-200 bg-white p-0 dark:border-zinc-800 dark:bg-zinc-900 sm:max-w-[425px]">
                <DialogHeader className="border-b border-zinc-100 p-4 dark:border-zinc-800">
                    <DialogTitle>New Message</DialogTitle>
                </DialogHeader>

                <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
                    <div className="relative">
                        <label htmlFor="new-message-recipient" className="sr-only">Search message recipients</label>
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                            id="new-message-recipient"
                            type="search"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-controls="new-message-recipient-results"
                            aria-expanded={results.length > 0}
                            aria-activedescendant={results.length > 0 ? `new-message-recipient-${activeIndex}` : undefined}
                            aria-busy={isSearching}
                            placeholder="Search people you can message..."
                            className="w-full rounded-lg bg-zinc-100 py-2 pl-9 pr-4 text-sm focus:outline-none   dark:bg-zinc-800"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (results.length === 0) return;
                                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    const direction = event.key === 'ArrowDown' ? 1 : -1;
                                    setActiveIndex((current) => (current + direction + results.length) % results.length);
                                } else if (event.key === 'Enter') {
                                    event.preventDefault();
                                    const result = results[activeIndex];
                                    if (result && !openingUserId) void handleSelectUser(result.userId);
                                }
                            }}
                            autoFocus
                        />
                    </div>
                </div>

                <div
                    id="new-message-recipient-results"
                    role={results.length > 0 ? 'listbox' : 'region'}
                    aria-label="Message recipients"
                    aria-busy={isSearching || Boolean(openingUserId)}
                    className="min-h-[200px] max-h-[300px] overflow-y-auto"
                >
                    {isSearching ? (
                        <div className="flex h-40 items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                        </div>
                    ) : searchError ? (
                        <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center" role="alert">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Unable to load recipients</p>
                            <p className="text-xs text-zinc-500">{searchError}</p>
                            <button type="button" onClick={() => void loadConnections({ append: false })} className="rounded-lg border px-3 py-1.5 text-xs font-medium">
                                Retry
                            </button>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex h-40 flex-col items-center justify-center text-zinc-500">
                            <UserPlus className="mb-2 h-8 w-8 text-zinc-400 opacity-50" />
                            <p className="text-sm">{query.trim() ? 'No eligible recipients found' : 'No one is available to message yet'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {results.map((result, index) => {
                                const identity = buildIdentityPresentation(result);
                                return (
                                <button
                                    key={result.userId}
                                    id={`new-message-recipient-${index}`}
                                    role="option"
                                    aria-selected={activeIndex === index}
                                    onClick={() => void handleSelectUser(result.userId)}
                                    onMouseMove={() => setActiveIndex(index)}
                                    disabled={Boolean(openingUserId)}
                                    className="group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-zinc-800/50"
                                >
                                    <div className={cn("h-10 w-10 flex-shrink-0 overflow-hidden rounded-full", identity.avatarUrl ? "bg-zinc-200 dark:bg-zinc-800" : identity.gradientClass)}>
                                        {identity.avatarUrl ? (
                                            <Image
                                                src={identity.avatarUrl}
                                                alt={identity.alt}
                                                width={40}
                                                height={40}
                                                unoptimized
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-xs font-medium text-white">
                                                {identity.initials}
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {identity.displayName}
                                        </div>
                                        <div className="truncate text-xs text-zinc-500">
                                            {result.headline
                                                || (result.eligibility === 'application'
                                                    ? 'Application conversation'
                                                    : result.eligibility === 'connected'
                                                        ? 'Connected'
                                                        : 'Open to messages')}
                                        </div>
                                    </div>
                                    {openingUserId === result.userId ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                    ) : (
                                        <MessageSquare className="h-4 w-4 text-zinc-300 transition-colors group-hover:text-indigo-500" />
                                    )}
                                </button>
                                );
                            })}
                            {hasMore ? (
                                <div className="p-3">
                                    <button
                                        onClick={() => void loadMore()}
                                        disabled={isLoadingMore}
                                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                    >
                                        {isLoadingMore ? 'Loading…' : 'Load more'}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    )}
                    <div className="sr-only" aria-live="polite">
                        {isSearching
                            ? 'Searching recipients'
                            : searchError
                                ? 'Recipient search failed'
                                : `${results.length} recipient${results.length === 1 ? '' : 's'} available`}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
