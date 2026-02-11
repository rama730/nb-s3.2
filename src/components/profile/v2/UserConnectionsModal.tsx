'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { getAcceptedConnections } from '@/app/actions/connections';
import Image from 'next/image';
import Link from 'next/link';
import { profileHref } from '@/lib/routing/identifiers';

interface UserConnectionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    userName: string;
}

interface ConnectionUser {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
}

interface ConnectionRow {
    id: string;
    otherUser: ConnectionUser | null;
}

export function UserConnectionsModal({ isOpen, onClose, userId, userName }: UserConnectionsModalProps) {
    const [connections, setConnections] = useState<ConnectionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const requestTokenRef = useRef(0);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedSearch(searchQuery.trim());
        }, 250);
        return () => clearTimeout(timeout);
    }, [searchQuery]);

    const loadConnections = useCallback(async (opts?: { append?: boolean; search?: string }) => {
        const append = Boolean(opts?.append);
        const search = (opts?.search ?? debouncedSearch).trim();
        const requestToken = ++requestTokenRef.current;

        if (append) setLoadingMore(true);
        else setLoading(true);

        try {
            const response = await getAcceptedConnections({
                limit: 30,
                cursor: append ? cursor || undefined : undefined,
                search: search || undefined,
                targetUserId: userId,
            });

            if (requestToken !== requestTokenRef.current) return;

            const nextRows = (response.connections || []) as ConnectionRow[];
            setHasMore(Boolean(response.hasMore));
            setCursor(response.nextCursor || null);

            if (append) {
                setConnections((prev) => {
                    const seen = new Set(prev.map((row) => row.id));
                    const merged = [...prev];
                    for (const row of nextRows) {
                        if (seen.has(row.id)) continue;
                        seen.add(row.id);
                        merged.push(row);
                    }
                    return merged;
                });
                return;
            }

            setConnections(nextRows);
        } catch (error) {
            console.error(error);
            if (!append) {
                setConnections([]);
                setHasMore(false);
                setCursor(null);
            }
        } finally {
            if (requestToken === requestTokenRef.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [cursor, debouncedSearch, userId]);

    useEffect(() => {
        if (!isOpen || !userId) return;
        void loadConnections({ append: false, search: debouncedSearch });
    }, [debouncedSearch, isOpen, loadConnections, userId]);

    useEffect(() => {
        if (!isOpen) {
            requestTokenRef.current += 1;
            setSearchQuery('');
            setDebouncedSearch('');
            setConnections([]);
            setCursor(null);
            setHasMore(false);
            setLoading(true);
            setLoadingMore(false);
        }
    }, [isOpen]);

    const loadMore = useCallback(async () => {
        if (!hasMore || loadingMore || loading) return;
        await loadConnections({ append: true, search: debouncedSearch });
    }, [debouncedSearch, hasMore, loadConnections, loading, loadingMore]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                        {`${userName}'s Connections`}
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
                    ) : connections.length === 0 ? (
                        <div className="text-center py-8 text-zinc-500 text-sm">
                            {searchQuery ? 'No matching connections.' : 'No connections found.'}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {connections.map(conn => {
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
                            {hasMore && (
                                <div className="p-2">
                                    <button
                                        type="button"
                                        onClick={loadMore}
                                        disabled={loadingMore}
                                        className="w-full px-3 py-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                                    >
                                        {loadingMore ? 'Loading...' : 'Load more'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
