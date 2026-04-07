'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

interface MentionParticipant {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface MentionDropdownProps {
    query: string;
    participants: MentionParticipant[];
    onSelect: (participant: MentionParticipant) => void;
    onClose: () => void;
}

export function MentionDropdown({ query, participants, onSelect, onClose }: MentionDropdownProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const filtered = participants.filter((p) => {
        const q = query.toLowerCase();
        return (
            (p.username && p.username.toLowerCase().includes(q)) ||
            (p.fullName && p.fullName.toLowerCase().includes(q))
        );
    }).slice(0, 5);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (filtered[selectedIndex]) onSelect(filtered[selectedIndex]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [filtered, selectedIndex, onSelect, onClose]);

    if (filtered.length === 0) return null;

    return (
        <div ref={listRef} className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {filtered.map((participant, index) => (
                <button
                    key={participant.id}
                    type="button"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(participant);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                        index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                        {participant.avatarUrl ? (
                            <Image src={participant.avatarUrl} alt="" width={24} height={24} unoptimized className="h-full w-full object-cover" />
                        ) : (
                            <span className="text-[10px] font-medium">{(participant.fullName || participant.username || '?')[0].toUpperCase()}</span>
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{participant.fullName || participant.username}</div>
                        {participant.username && <div className="truncate text-xs text-zinc-500">@{participant.username}</div>}
                    </div>
                </button>
            ))}
        </div>
    );
}
