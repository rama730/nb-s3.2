'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Eye } from 'lucide-react';

interface ReadReceipt {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface ReadReceiptPopoverProps {
    readBy: ReadReceipt[];
    totalParticipants: number;
}

export function ReadReceiptPopover({ readBy, totalParticipants }: ReadReceiptPopoverProps) {
    const [showDetail, setShowDetail] = useState(false);

    if (readBy.length === 0) return null;

    return (
        <div className="relative inline-flex">
            <button
                type="button"
                onClick={() => setShowDetail((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label={`Seen by ${readBy.length} of ${totalParticipants}`}
            >
                <Eye className="h-3 w-3" />
                <span>Seen by {readBy.length}</span>
            </button>
            {showDetail && (
                <div className="absolute bottom-full right-0 z-20 mb-1 w-48 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="space-y-1.5">
                        {readBy.map((user) => (
                            <div key={user.id} className="flex items-center gap-2">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                    {user.avatarUrl ? (
                                        <Image src={user.avatarUrl} alt="" width={20} height={20} unoptimized className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="text-[8px] font-medium">{(user.fullName || user.username || '?')[0].toUpperCase()}</span>
                                    )}
                                </div>
                                <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">{user.fullName || user.username}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
