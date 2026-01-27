'use client';

import { useEffect, useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { getAcceptedConnections } from '@/app/actions/connections';
import Image from 'next/image';
import Link from 'next/link';
import { profileHref } from '@/lib/routing/identifiers';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog'; // Assuming these exist, else use simple fixed div

interface UserConnectionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    userName: string;
}

export function UserConnectionsModal({ isOpen, onClose, userId, userName }: UserConnectionsModalProps) {
    const [connections, setConnections] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (isOpen && userId) {
            setLoading(true);
            getAcceptedConnections(50, undefined, userId) // Passed userId
                .then(res => {
                    setConnections(res.connections);
                })
                .catch(err => console.error(err))
                .finally(() => setLoading(false));
        }
    }, [isOpen, userId]);

    const filtered = connections.filter(c => {
        const u = c.otherUser;
        if (!u) return false;
        const q = searchQuery.toLowerCase();
        return (u.fullName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q);
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                        {userName}'s Connections
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                        <X className="w-5 h-5 text-zinc-500" />
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                            type="text"
                            placeholder="Search connections..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border-none focus:ring-2 focus:ring-blue-500/20 text-sm"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-8 text-zinc-500 text-sm">
                            {searchQuery ? 'No matching connections.' : 'No connections found.'}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filtered.map(conn => {
                                const u = conn.otherUser;
                                if (!u) return null;
                                return (
                                    <Link
                                        key={conn.id}
                                        href={profileHref(u)}
                                        onClick={onClose}
                                        className="flex items-center gap-3 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-xl transition-colors group"
                                    >
                                        {u.avatarUrl ? (
                                            <Image
                                                src={u.avatarUrl}
                                                alt={u.username || 'User'}
                                                width={40}
                                                height={40}
                                                className="rounded-full object-cover w-10 h-10 border border-zinc-100 dark:border-zinc-800"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                                                {(u.fullName || u.username || 'U')[0]?.toUpperCase()}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                {u.fullName || u.username}
                                            </div>
                                            {u.headline && (
                                                <div className="text-xs text-zinc-500 truncate">{u.headline}</div>
                                            )}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
