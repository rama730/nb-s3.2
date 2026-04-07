'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Loader2, UserPlus, MessageSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/hub/useDebounce';
import { getAcceptedConnections } from '@/app/actions/connections';
import { toast } from 'sonner';
import { useEnsureDirectConversation } from '@/hooks/useMessagesV2';
import { logger } from '@/lib/logger';
import { upsertInboxConversation } from '@/lib/messages/v2-cache';

interface NewMessageModalV2Props {
    isOpen: boolean;
    onClose: () => void;
    onConversationOpened: (conversationId: string) => void;
}

type ConnectionRow = {
    id: string;
    otherUser?: {
        id?: string;
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
        headline?: string | null;
    } | null;
};

type ConnectionSearchResult = {
    connectionId: string;
    userId: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
};

export function NewMessageModalV2({
    isOpen,
    onClose,
    onConversationOpened,
}: NewMessageModalV2Props) {
    const queryClient = useQueryClient();
    const ensureConversation = useEnsureDirectConversation();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ConnectionSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [, setCursor] = useState<string | null>(null);
    const [openingUserId, setOpeningUserId] = useState<string | null>(null);
    const debouncedQuery = useDebounce(query, 300);
    const requestTokenRef = useRef(0);
    const cursorRef = useRef<string | null>(null);

    const normalizeRows = useCallback((rows: ConnectionRow[]) => {
        return rows
            .map((row) => {
                const user = row?.otherUser;
                if (!user?.id) return null;
                return {
                    connectionId: row.id,
                    userId: user.id,
                    username: user.username ?? null,
                    fullName: user.fullName ?? null,
                    avatarUrl: user.avatarUrl ?? null,
                    headline: user.headline ?? null,
                };
            })
            .filter(Boolean) as ConnectionSearchResult[];
    }, []);

    const loadConnections = useCallback(async (opts?: { append?: boolean; search?: string }) => {
        const append = Boolean(opts?.append);
        const search = (opts?.search ?? debouncedQuery).trim();
        const requestToken = ++requestTokenRef.current;

        if (append) setIsLoadingMore(true);
        else setIsSearching(true);

        try {
            const response = await getAcceptedConnections({
                limit: 30,
                cursor: append ? cursorRef.current || undefined : undefined,
                search: search || undefined,
            });

            if (requestToken !== requestTokenRef.current) return;

            const normalized = normalizeRows(response.connections || []);
            setHasMore(Boolean(response.hasMore));
            const nextCursor = response.nextCursor || null;
            setCursor(nextCursor);
            cursorRef.current = nextCursor;

            if (append) {
                setResults((prev) => {
                    const seen = new Set(prev.map((item) => item.userId));
                    const merged = [...prev];
                    for (const item of normalized) {
                        if (seen.has(item.userId)) continue;
                        seen.add(item.userId);
                        merged.push(item);
                    }
                    return merged;
                });
            } else {
                setResults(normalized);
            }
        } catch (error) {
            logger.error('[messages-v2] failed to load accepted connections', {
                module: 'messages',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            if (!append) setResults([]);
        } finally {
            if (requestToken === requestTokenRef.current) {
                setIsSearching(false);
                setIsLoadingMore(false);
            }
        }
    }, [debouncedQuery, normalizeRows]);

    useEffect(() => {
        if (!isOpen) return;
        void loadConnections({ append: false, search: debouncedQuery });
    }, [debouncedQuery, isOpen, loadConnections]);

    useEffect(() => {
        if (isOpen) return;
        setQuery('');
        setResults([]);
        setCursor(null);
        cursorRef.current = null;
        setHasMore(false);
        setIsSearching(false);
        setIsLoadingMore(false);
        requestTokenRef.current += 1;
    }, [isOpen]);

    const loadMore = async () => {
        if (!hasMore || isLoadingMore || isSearching) return;
        await loadConnections({ append: true, search: debouncedQuery });
    };

    const handleSelectUser = async (userId: string) => {
        if (openingUserId) return;
        setOpeningUserId(userId);
        try {
            const result = await ensureConversation.mutateAsync(userId);
            if (!result.conversationId) {
                toast.error('Failed to open conversation');
                return;
            }
            upsertInboxConversation(queryClient, result.conversation!);
            onConversationOpened(result.conversationId);
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to open conversation');
        } finally {
            setOpeningUserId(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="gap-0 overflow-hidden border-zinc-200 bg-white p-0 dark:border-zinc-800 dark:bg-zinc-900 sm:max-w-[425px]">
                <DialogHeader className="border-b border-zinc-100 p-4 dark:border-zinc-800">
                    <DialogTitle>New Message</DialogTitle>
                </DialogHeader>

                <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text"
                            placeholder="Search connections..."
                            className="w-full rounded-lg bg-zinc-100 py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:bg-zinc-800"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="min-h-[200px] max-h-[300px] overflow-y-auto">
                    {isSearching ? (
                        <div className="flex h-40 items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex h-40 flex-col items-center justify-center text-zinc-500">
                            <UserPlus className="mb-2 h-8 w-8 text-zinc-400 opacity-50" />
                            <p className="text-sm">{query.trim() ? 'No connections found' : 'No connections yet'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {results.map((result) => (
                                <button
                                    key={result.userId}
                                    onClick={() => void handleSelectUser(result.userId)}
                                    disabled={openingUserId === result.userId}
                                    className="group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                >
                                    <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                                        {result.avatarUrl ? (
                                            <Image
                                                src={result.avatarUrl}
                                                alt=""
                                                width={40}
                                                height={40}
                                                unoptimized
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-xs font-medium text-zinc-500">
                                                {result.fullName?.[0] || result.username?.[0] || '?'}
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {result.fullName || result.username}
                                        </div>
                                        <div className="truncate text-xs text-zinc-500">
                                            {result.headline || 'Start a new conversation'}
                                        </div>
                                    </div>
                                    {openingUserId === result.userId ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                    ) : (
                                        <MessageSquare className="h-4 w-4 text-zinc-300 transition-colors group-hover:text-indigo-500" />
                                    )}
                                </button>
                            ))}
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
                </div>
            </DialogContent>
        </Dialog>
    );
}
