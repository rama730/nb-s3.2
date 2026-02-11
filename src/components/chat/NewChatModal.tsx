"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Loader2, UserPlus, MessageSquare } from "lucide-react";
import { useDebounce } from "@/hooks/hub/useDebounce";
import { getAcceptedConnections } from "@/app/actions/connections";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { toast } from "sonner";

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function NewChatModal({ isOpen, onClose }: NewChatModalProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [cursor, setCursor] = useState<string | null>(null);
    const [openingUserId, setOpeningUserId] = useState<string | null>(null);
    const debouncedQuery = useDebounce(query, 300);
    const router = useRouter();
    const pathname = usePathname();
    const startConversationWithUser = useChatStore((state) => state.startConversationWithUser);
    const conversations = useChatStore((state) => state.conversations);
    const requestTokenRef = useRef(0);

    const existingConversationUserIds = useMemo(() => {
        const ids = new Set<string>();
        for (const conversation of conversations) {
            if (conversation.type !== "dm") continue;
            for (const participant of conversation.participants) {
                ids.add(participant.id);
            }
        }
        return ids;
    }, [conversations]);

    const normalizeRows = useCallback((rows: any[]) => {
        const next = rows
            .map((row) => {
                const user = row?.otherUser;
                if (!user?.id) return null;
                return {
                    connectionId: row.id as string,
                    userId: user.id as string,
                    username: user.username as string | null,
                    fullName: user.fullName as string | null,
                    avatarUrl: user.avatarUrl as string | null,
                    headline: user.headline as string | null,
                };
            })
            .filter(Boolean) as Array<{
                connectionId: string;
                userId: string;
                username: string | null;
                fullName: string | null;
                avatarUrl: string | null;
                headline: string | null;
            }>;

        return next;
    }, []);

    const loadConnections = useCallback(async (opts?: { append?: boolean; search?: string }) => {
        const append = !!opts?.append;
        const search = (opts?.search ?? debouncedQuery).trim();
        const requestToken = ++requestTokenRef.current;

        if (append) setIsLoadingMore(true);
        else setIsSearching(true);

        try {
            const response = await getAcceptedConnections({
                limit: 30,
                cursor: append ? cursor || undefined : undefined,
                search: search || undefined,
            });

            if (requestToken !== requestTokenRef.current) return;

            const normalized = normalizeRows(response.connections || []);
            setHasMore(Boolean(response.hasMore));
            setCursor(response.nextCursor || null);

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
            console.error("Failed to load connections", error);
            if (!append) setResults([]);
        } finally {
            if (requestToken === requestTokenRef.current) {
                setIsSearching(false);
                setIsLoadingMore(false);
            }
        }
    }, [cursor, debouncedQuery, normalizeRows]);

    useEffect(() => {
        if (!isOpen) return;
        void loadConnections({ append: false, search: debouncedQuery });
    }, [debouncedQuery, isOpen, loadConnections]);

    useEffect(() => {
        if (isOpen) return;
        setQuery("");
        setResults([]);
        setCursor(null);
        setHasMore(false);
        setIsSearching(false);
        setIsLoadingMore(false);
        requestTokenRef.current += 1;
    }, [isOpen]);

    const loadMore = async () => {
        if (!hasMore || isLoadingMore || isSearching) return;
        await loadConnections({ append: true, search: debouncedQuery });
    };

    const handleModalOpenChange = (open: boolean) => {
        if (!open) {
            onClose();
        }
    };

    const handleSelectUser = async (userId: string) => {
        if (openingUserId) return;
        setOpeningUserId(userId);
        try {
            const conversationId = await startConversationWithUser(userId);
            if (!conversationId) {
                toast.error("Failed to open conversation");
                return;
            }
            onClose();
            if (pathname.startsWith("/messages")) {
                router.replace(`/messages?conversationId=${conversationId}`);
            } else {
                router.push(`/messages?conversationId=${conversationId}`);
            }
        } finally {
            setOpeningUserId(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleModalOpenChange}>
            <DialogContent className="sm:max-w-[425px] p-0 gap-0 overflow-hidden bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                <DialogHeader className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                    <DialogTitle>New Message</DialogTitle>
                </DialogHeader>

                <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                            type="text"
                            placeholder="Search connections..."
                            className="w-full pl-9 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="max-h-[300px] overflow-y-auto min-h-[200px]">
                    {isSearching ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                            <UserPlus className="w-8 h-8 mb-2 opacity-50 text-zinc-400" />
                            <p className="text-sm">
                                {query.trim() ? "No connections found" : "No connections yet"}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {results.map((user) => (
                                <button
                                    key={user.userId}
                                    onClick={() => handleSelectUser(user.userId)}
                                    disabled={openingUserId === user.userId}
                                    className="w-full flex items-center gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex-shrink-0">
                                        {user.avatarUrl ? (
                                            <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-medium">
                                                {user.fullName?.[0] || user.username?.[0] || '?'}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                                            {user.fullName || user.username}
                                        </div>
                                        {user.headline ? (
                                            <div className="text-xs text-zinc-500 truncate">
                                                {user.headline}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-zinc-500 truncate">
                                                {existingConversationUserIds.has(user.userId) ? "Open existing conversation" : "Start a new conversation"}
                                            </div>
                                        )}
                                    </div>
                                    {openingUserId === user.userId ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                    ) : (
                                        <MessageSquare className="w-4 h-4 text-zinc-300 group-hover:text-indigo-500 transition-colors" />
                                    )}
                                </button>
                            ))}
                            {hasMore && (
                                <div className="p-3">
                                    <button
                                        onClick={loadMore}
                                        disabled={isLoadingMore}
                                        className="w-full px-3 py-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                                    >
                                        {isLoadingMore ? "Loading..." : "Load more connections"}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
