'use client';

import { memo, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
    UserPlus,
    FileText,
    Loader2,
    Check,
    X,
    Archive,
    MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceInbox, type WorkspaceInboxItem } from '@/app/actions/workspace';
import { acceptConnectionRequest, rejectConnectionRequest } from '@/app/actions/connections';
import { toast } from 'sonner';

function InboxTab() {
    const queryClient = useQueryClient();
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [allItems, setAllItems] = useState<WorkspaceInboxItem[]>([]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['workspace', 'inbox', cursor],
        queryFn: async () => {
            const result = await getWorkspaceInbox(cursor, 10);
            if (result.success && result.items) {
                if (cursor) {
                    setAllItems(prev => [...prev, ...result.items!]);
                } else {
                    setAllItems(result.items);
                }
            }
            return result;
        },
        staleTime: 30_000,
    });

    const handleLoadMore = useCallback(() => {
        if (data?.nextCursor) {
            setCursor(data.nextCursor);
        }
    }, [data]);

    const handleAcceptConnection = useCallback(async (connectionId: string) => {
        // Optimistic: remove item from list
        setAllItems(prev => prev.filter(i => i.meta.connectionId !== connectionId));
        try {
            await acceptConnectionRequest(connectionId);
            toast.success('Connection accepted');
        } catch {
            toast.error('Failed to accept connection');
        }
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
    }, [queryClient]);

    const handleRejectConnection = useCallback(async (connectionId: string) => {
        // Optimistic: remove item from list
        setAllItems(prev => prev.filter(i => i.meta.connectionId !== connectionId));
        try {
            await rejectConnectionRequest(connectionId);
            toast.success('Connection declined');
        } catch {
            toast.error('Failed to decline connection');
        }
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
    }, [queryClient]);

    if (isLoading && allItems.length === 0) {
        return (
            <div className="flex items-center justify-center py-16 text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading inbox...</span>
            </div>
        );
    }

    if (allItems.length === 0) {
        return (
            <div className="text-center py-16 text-zinc-400">
                <div className="w-16 h-16 mx-auto mb-4 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center">
                    <Archive className="w-8 h-8 opacity-50" />
                </div>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Inbox Zero</p>
                <p className="text-xs text-zinc-400 mt-1">You&apos;re all caught up!</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    {allItems.length} pending items
                </span>
            </div>

            {allItems.map((item) => (
                <InboxCard
                    key={item.id}
                    item={item}
                    onAcceptConnection={handleAcceptConnection}
                    onRejectConnection={handleRejectConnection}
                />
            ))}

            {data?.hasMore && (
                <div className="flex justify-center pt-4">
                    <button
                        onClick={handleLoadMore}
                        disabled={isFetching}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 flex items-center gap-2"
                    >
                        {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
                        Load more
                    </button>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// InboxCard — Isolated card for each inbox item
// ============================================================================

interface InboxCardProps {
    item: WorkspaceInboxItem;
    onAcceptConnection: (connectionId: string) => void;
    onRejectConnection: (connectionId: string) => void;
}

function InboxCard({ item, onAcceptConnection, onRejectConnection }: InboxCardProps) {
    const isConnection = item.type === 'connection_request';
    const connectionId = typeof item.meta.connectionId === 'string' ? item.meta.connectionId : null;
    const conversationId = typeof item.meta.conversationId === 'string' ? item.meta.conversationId : null;
    const projectSlug = typeof item.meta.projectSlug === 'string' ? item.meta.projectSlug : null;
    const Icon = isConnection ? UserPlus : FileText;
    const iconBg = isConnection
        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
        : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';

    return (
        <div className="flex items-start gap-3 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:shadow-sm transition-all">
            <div className="shrink-0">
                {item.avatarUrl ? (
                    <img
                        src={item.avatarUrl}
                        alt={item.title}
                        className="w-10 h-10 rounded-full object-cover"
                    />
                ) : (
                    <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', iconBg)}>
                        <Icon className="w-5 h-5" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {item.title}
                        </h4>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                            {item.subtitle}
                        </p>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                        {formatTimeAgo(item.createdAt)}
                    </span>
                </div>

                <div className="flex items-center gap-2 mt-3">
                    {isConnection && (
                        <>
                            <button
                                onClick={() => connectionId && onAcceptConnection(connectionId)}
                                disabled={!connectionId}
                                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                                <Check className="w-3 h-3" />
                                Accept
                            </button>
                            <button
                                onClick={() => connectionId && onRejectConnection(connectionId)}
                                disabled={!connectionId}
                                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <X className="w-3 h-3" />
                                Decline
                            </button>
                        </>
                    )}
                    {!isConnection && conversationId && (
                        <Link
                            href={`/messages?conversationId=${conversationId}`}
                            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        >
                            <MessageSquare className="w-3 h-3" />
                            View Chat
                        </Link>
                    )}
                    {!isConnection && projectSlug && (
                        <Link
                            href={`/projects/${projectSlug}`}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            View Project
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatTimeAgo(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default memo(InboxTab);
