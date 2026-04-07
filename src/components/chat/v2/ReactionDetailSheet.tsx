'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';

interface ReactionUser {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface ReactionDetail {
    emoji: string;
    users: ReactionUser[];
}

interface ReactionDetailSheetProps {
    details: ReactionDetail[];
    activeEmoji: string;
    onClose: () => void;
}

export function ReactionDetailSheet({ details, activeEmoji, onClose }: ReactionDetailSheetProps) {
    const activeDetail = details.find((d) => d.emoji === activeEmoji) ?? details[0];
    const backdropRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    if (!activeDetail) return null;

    return (
        <div ref={backdropRef} className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center" onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}>
            <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl dark:bg-zinc-900">
                <div className="mb-3 flex items-center justify-between">
                    <div className="flex gap-2">
                        {details.map((d) => (
                            <span key={d.emoji} className={`rounded-full px-2 py-1 text-sm ${d.emoji === activeDetail.emoji ? 'bg-primary/10 font-semibold' : 'text-zinc-500'}`}>
                                {d.emoji} {d.users.length}
                            </span>
                        ))}
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                    {activeDetail.users.map((user) => (
                        <div key={user.id} className="flex items-center gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                {user.avatarUrl ? (
                                    <Image src={user.avatarUrl} alt="" width={32} height={32} unoptimized className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-xs font-medium">{(user.fullName || user.username || '?')[0].toUpperCase()}</span>
                                )}
                            </div>
                            <span className="text-sm text-zinc-900 dark:text-zinc-100">{user.fullName || user.username || 'Unknown'}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
