"use client";

import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Loader2, UserPlus, MessageSquare } from "lucide-react";
import { useDebounce } from "@/hooks/hub/useDebounce";
import { searchConnections } from "@/app/actions/connections";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function NewChatModal({ isOpen, onClose }: NewChatModalProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const debouncedQuery = useDebounce(query, 300);
    const router = useRouter();

    useEffect(() => {
        async function performSearch() {
            if (!debouncedQuery.trim()) {
                setResults([]);
                return;
            }

            setIsSearching(true);
            try {
                const response = await searchConnections(debouncedQuery);
                if (response.success && response.connections) {
                    setResults(response.connections);
                }
            } catch (error) {
                console.error("Search failed", error);
            } finally {
                setIsSearching(false);
            }
        }

        performSearch();
    }, [debouncedQuery]);

    const handleSelectUser = (userId: string) => {
        onClose();
        // Redirect to messages with userId param to start Draft/Open chat
        router.push(`/messages?userId=${userId}`);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
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
                    ) : query.trim() && results.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                            <p className="text-sm">No connections found</p>
                        </div>
                    ) : !query.trim() ? (
                        <div className="flex flex-col items-center justify-center h-40 text-zinc-400">
                            <UserPlus className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">Type to search people you know</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {results.map((user) => (
                                <button
                                    key={user.userId}
                                    onClick={() => handleSelectUser(user.userId)}
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
                                        {user.headline && (
                                            <div className="text-xs text-zinc-500 truncate">
                                                {user.headline}
                                            </div>
                                        )}
                                    </div>
                                    <MessageSquare className="w-4 h-4 text-zinc-300 group-hover:text-indigo-500 transition-colors" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
