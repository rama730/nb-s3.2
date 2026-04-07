'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface InboxListSkeletonV2Props {
    surface: 'page' | 'popup';
    showSearch?: boolean;
    rows?: number;
}

interface ThreadSkeletonV2Props {
    surface: 'page' | 'popup';
    showHeader?: boolean;
    showComposer?: boolean;
}

export function InboxListSkeletonV2({
    surface,
    showSearch = true,
    rows = surface === 'popup' ? 5 : 7,
}: InboxListSkeletonV2Props) {
    const isPopup = surface === 'popup';

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {showSearch ? (
                <div className={cn(
                    'border-b border-zinc-100',
                    isPopup ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3',
                )}>
                    <div className="rounded-2xl border border-zinc-200/80 bg-white/90 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                        <div className="flex items-center gap-3 rounded-[18px] bg-zinc-50 px-3 py-2.5">
                            <Skeleton className="h-4 w-4 rounded-full" />
                            <Skeleton className={cn(isPopup ? 'w-32' : 'w-36', 'h-4 rounded-full')} />
                        </div>
                    </div>
                </div>
            ) : null}

            <div className={cn('flex-1 overflow-hidden pb-2 pt-2', isPopup ? 'px-2' : 'px-2.5')}>
                {Array.from({ length: rows }).map((_, index) => (
                    <div key={`messages-row-skeleton-${index}`} className="px-2 py-1">
                        <div
                            className={cn(
                                'relative flex items-center gap-3 rounded-2xl border border-transparent px-4',
                                isPopup ? 'min-h-[74px] py-3' : 'min-h-[80px] py-3.5',
                            )}
                        >
                            <Skeleton className={cn(isPopup ? 'h-11 w-11' : 'h-12 w-12', 'shrink-0 rounded-full')} />
                            <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <Skeleton className={cn(isPopup ? 'h-4 w-24' : 'h-4 w-28', 'rounded-full')} />
                                    <Skeleton className="h-3 w-11 rounded-full" />
                                </div>
                                <Skeleton className={cn(isPopup ? 'h-3.5 w-[72%]' : 'h-3.5 w-[78%]', 'rounded-full')} />
                                <Skeleton className={cn(isPopup ? 'h-3 w-[34%]' : 'h-3 w-[38%]', 'rounded-full')} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ConversationHeaderSkeletonV2({ surface = 'page' }: { surface?: 'page' | 'popup' }) {
    const isPopup = surface === 'popup';
    return (
        <div className={cn(
            'flex items-center justify-between border-b border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950',
            isPopup ? 'px-3 py-3' : 'px-5 py-4',
        )}>
            <div className="flex min-w-0 items-center gap-3">
                <Skeleton className={cn(isPopup ? 'h-9 w-9' : 'h-10 w-10', 'rounded-full')} />
                <div className="space-y-2">
                    <Skeleton className="h-4 w-28 rounded-full" />
                    <Skeleton className="h-3 w-20 rounded-full" />
                </div>
            </div>
            <Skeleton className="h-8 w-8 rounded-full" />
        </div>
    );
}

export function ThreadSkeletonV2({
    surface,
    showHeader = true,
    showComposer = true,
}: ThreadSkeletonV2Props) {
    const isPopup = surface === 'popup';
    const rows = isPopup
        ? [
            { own: false, bubble: 'h-[54px] w-[60%]', meta: 'w-12' },
            { own: true, bubble: 'h-[42px] w-[34%]', meta: 'w-10' },
            { own: false, bubble: 'h-[48px] w-[48%]', meta: 'w-14' },
        ]
        : [
            { own: false, bubble: 'h-[64px] w-[46%]', meta: 'w-16' },
            { own: true, bubble: 'h-[54px] w-[30%]', meta: 'w-12' },
            { own: false, bubble: 'h-[58px] w-[40%]', meta: 'w-14' },
            { own: true, bubble: 'h-[48px] w-[24%]', meta: 'w-12' },
        ];

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white">
            {showHeader ? (
                <div className={cn(
                    'border-b border-zinc-100 bg-white',
                    isPopup ? 'px-3 py-3' : 'px-5 py-4',
                )}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            {isPopup ? <Skeleton className="h-8 w-8 rounded-full" /> : null}
                            <Skeleton className={cn(isPopup ? 'h-9 w-9' : 'h-10 w-10', 'rounded-full')} />
                            <div className="min-w-0 space-y-2">
                                <Skeleton className={cn(isPopup ? 'h-4 w-24' : 'h-4 w-32', 'rounded-full')} />
                                <Skeleton className={cn(isPopup ? 'h-3 w-20' : 'h-3 w-24', 'rounded-full')} />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Skeleton className={cn('rounded-full', isPopup ? 'h-8 w-14' : 'h-9 w-16')} />
                            {!isPopup ? <Skeleton className="h-9 w-9 rounded-full" /> : null}
                        </div>
                    </div>
                </div>
            ) : null}

            <div className={cn(
                'flex-1 min-h-0 overflow-hidden bg-white',
                isPopup ? 'px-3 py-3' : 'px-5 py-4',
            )}>
                <div className="flex h-full min-h-0 flex-col">
                    <div className="flex justify-center">
                        <Skeleton className={cn('rounded-full', isPopup ? 'h-5 w-16' : 'h-6 w-20')} />
                    </div>
                    <div className={cn(
                        'flex min-h-0 flex-1 flex-col justify-end',
                        isPopup ? 'gap-5 pt-4' : 'gap-6 pt-6',
                    )}>
                        {rows.map((row, index) => {
                            const isOwn = row.own;
                            return (
                                <div
                                    key={`messages-thread-skeleton-${index}`}
                                    className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}
                                >
                                    <div className={cn('flex flex-col space-y-2', isOwn ? 'items-end' : 'items-start')}>
                                        {!isOwn ? (
                                            <div className="mb-1 flex items-center gap-2">
                                                <Skeleton className={cn('rounded-full', isPopup ? 'h-6 w-6' : 'h-7 w-7')} />
                                                <Skeleton className={cn('h-3 rounded-full', isPopup ? 'w-14' : 'w-16')} />
                                            </div>
                                        ) : null}
                                        <Skeleton
                                            className={cn(
                                                'rounded-[22px]',
                                                row.bubble,
                                            )}
                                        />
                                        <div className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
                                            <Skeleton className={cn('h-3 rounded-full', row.meta)} />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {showComposer ? (
                <div className={cn(
                    'border-t border-zinc-100 bg-white',
                    isPopup ? 'px-3 py-3' : 'px-5 py-4',
                )}>
                    <div className={cn(
                        'rounded-[30px] border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
                        isPopup ? 'p-1.5' : 'p-2',
                    )}>
                        <div className="flex items-end gap-2">
                            <Skeleton className={cn('rounded-full', isPopup ? 'h-9 w-9' : 'h-10 w-10')} />
                            <Skeleton className={cn('flex-1 rounded-[22px]', isPopup ? 'h-[42px]' : 'h-[44px]')} />
                            <Skeleton className={cn('rounded-full', isPopup ? 'h-9 w-9' : 'h-10 w-10')} />
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
