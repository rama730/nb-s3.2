'use client';

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationWithDetails } from '@/app/actions/messaging';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface RecentMessagesProps {
    conversations: ConversationWithDetails[];
    sizeMode?: WidgetCardSizeMode;
}

function RecentMessages({ conversations, sizeMode = 'standard' }: RecentMessagesProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 3 : sizeMode === 'expanded' ? 6 : 4;
    const showSnippet = sizeMode !== 'compact';

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-violet-50 dark:bg-violet-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <MessageSquare className={cn('text-violet-600 dark:text-violet-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Recent Messages
                    </h3>
                </div>
                <Link
                    href="/messages"
                    className={cn(
                        'text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1',
                        isCompact ? 'text-[11px]' : 'text-xs'
                    )}
                >
                    Open Messages {!isCompact && <ArrowRight className="w-3 h-3" />}
                </Link>
            </div>

            {conversations.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No recent conversations.</p>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-0.5' : 'space-y-1')}>
                    {conversations.slice(0, visibleLimit).map((conv) => {
                        const otherUser = conv.participants?.[0];
                        const displayName = otherUser?.fullName || otherUser?.username || 'Unknown';
                        const avatar = otherUser?.avatarUrl;

                        return (
                            <Link
                                key={conv.id}
                                href={`/messages?conversationId=${conv.id}`}
                                className={cn(
                                    'flex items-center rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5 group',
                                    isCompact ? 'gap-2 p-2' : 'gap-3 p-2.5'
                                )}
                            >
                                {/* Avatar */}
                                <div className="relative shrink-0">
                                    {avatar ? (
                                        <Image
                                            src={avatar}
                                            alt={displayName}
                                            width={isCompact ? 28 : 32}
                                            height={isCompact ? 28 : 32}
                                            unoptimized
                                            className={cn('rounded-full object-cover', isCompact ? 'w-7 h-7' : 'w-8 h-8')}
                                        />
                                    ) : (
                                        <div className={cn(
                                            'rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center font-medium text-zinc-600 dark:text-zinc-300',
                                            isCompact ? 'w-7 h-7 text-[11px]' : 'w-8 h-8 text-xs'
                                        )}>
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    {conv.unreadCount > 0 && (
                                        <div className={cn(
                                            'absolute -top-0.5 -right-0.5 bg-blue-500 rounded-full ring-2 ring-white dark:ring-zinc-900',
                                            isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'
                                        )} />
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <span className={cn(
                                            'truncate',
                                            isCompact ? 'text-[13px]' : 'text-sm',
                                            conv.unreadCount > 0
                                                ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                                                : 'font-medium text-zinc-700 dark:text-zinc-300'
                                        )}>
                                            {displayName}
                                        </span>
                                        {conv.lastMessage && (
                                            <span className={cn(
                                                'text-zinc-400 shrink-0 ml-2',
                                                isCompact ? 'text-[9px]' : 'text-[10px]'
                                            )}>
                                                {formatTime(conv.lastMessage.createdAt)}
                                            </span>
                                        )}
                                    </div>
                                    {showSnippet && conv.lastMessage?.content && (
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                                            {conv.lastMessage.content}
                                        </p>
                                    )}
                                </div>

                                {/* Unread badge */}
                                {conv.unreadCount > 0 && (
                                    <span className={cn(
                                        'font-bold text-white bg-blue-500 rounded-full flex items-center justify-center shrink-0',
                                        isCompact ? 'text-[9px] w-4 h-4' : 'text-[10px] w-5 h-5'
                                    )}>
                                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function formatTime(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default memo(RecentMessages);
