'use client';

import { useState } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { GroupedReactionDetail } from '@/lib/messages/reactions';

export interface ReactionDetailSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    reactionDetails: GroupedReactionDetail[];
}

/**
 * Bottom sheet that displays per-emoji user lists for group conversations.
 * Triggered on long-press or double-tap on a reaction pill.
 * Each tab shows the emoji + count as a header, then a list of users (avatar + username).
 */
export function ReactionDetailSheet({
    open,
    onOpenChange,
    reactionDetails,
}: ReactionDetailSheetProps) {
    const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

    // Resolve the active tab — default to first emoji if not set
    const resolvedTab = activeTab && reactionDetails.some((d) => d.emoji === activeTab)
        ? activeTab
        : reactionDetails[0]?.emoji;

    if (reactionDetails.length === 0) return null;

    const totalReactions = reactionDetails.reduce((sum, d) => sum + d.users.length, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-lg rounded-t-2xl border-t bg-white p-0 shadow-xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom dark:bg-zinc-900 sm:inset-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border"
                showCloseButton={false}
                aria-label="Reaction details"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 pt-4 pb-2 dark:border-zinc-800">
                    <div>
                        <DialogTitle className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                            Reactions
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
                            {totalReactions} {totalReactions === 1 ? 'reaction' : 'reactions'} total
                        </DialogDescription>
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        aria-label="Close reaction details"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Tabs for each emoji */}
                <Tabs
                    value={resolvedTab}
                    onValueChange={setActiveTab}
                    className="flex flex-col gap-0"
                >
                    <TabsList
                        className="mx-4 mt-3 flex h-auto w-auto flex-wrap justify-start gap-1 bg-transparent p-0"
                        aria-label="Reaction emoji tabs"
                    >
                        {reactionDetails.map((detail) => (
                            <TabsTrigger
                                key={detail.emoji}
                                value={detail.emoji}
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-sm data-[state=active]:border-primary/30 data-[state=active]:bg-primary/10 data-[state=active]:font-semibold dark:border-zinc-700 data-[state=active]:dark:border-primary/30"
                                aria-label={`${detail.emoji} ${detail.users.length} ${detail.users.length === 1 ? 'reaction' : 'reactions'}`}
                            >
                                <span aria-hidden="true">{detail.emoji}</span>
                                <span>{detail.users.length}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    {/* User lists per emoji */}
                    {reactionDetails.map((detail) => (
                        <TabsContent
                            key={detail.emoji}
                            value={detail.emoji}
                            className="mx-4 mt-2 mb-4 max-h-56 overflow-y-auto"
                        >
                            <ul
                                className="space-y-1"
                                role="list"
                                aria-label={`Users who reacted with ${detail.emoji}`}
                            >
                                {detail.users.map((user) => (
                                    <li
                                        key={user.userId}
                                        className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                                    >
                                        {/* Avatar */}
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                            {user.avatarUrl ? (
                                                <Image
                                                    src={user.avatarUrl}
                                                    alt={`${user.username}'s avatar`}
                                                    width={32}
                                                    height={32}
                                                    unoptimized
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <span
                                                    className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
                                                    aria-hidden="true"
                                                >
                                                    {(user.username || '?')[0]!.toUpperCase()}
                                                </span>
                                            )}
                                        </div>

                                        {/* Username */}
                                        <span className="text-sm text-zinc-900 dark:text-zinc-100">
                                            {user.username || 'Unknown'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </TabsContent>
                    ))}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
