"use client";

import { useState, forwardRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, Users, MessageSquare, X, Loader2, TrendingUp, UserCheck, SendHorizontal, CalendarDays } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VirtuosoGrid } from "react-virtuoso";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { profileHref } from "@/lib/routing/identifiers";
import { useConnections, useConnectionStats, useConnectionMutations } from "@/hooks/useConnections";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";

interface ConnectionsClientProps {
    initialUser: any;
    embedded?: boolean;
}

export default function ConnectionsClient({
    embedded = false
}: ConnectionsClientProps) {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch] = useDebounce(searchQuery, 300); // We need a debounce hook here

    const { 
        data: connectionsData, 
        isLoading: connectionsLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useConnections(50, debouncedSearch);
    
    const { data: statsData, isLoading: statsLoading } = useConnectionStats();
    const { disconnect } = useConnectionMutations();

    const GridList = useMemo(() => {
        const Component = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
            <div {...props} ref={ref} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-8" />
        ));
        Component.displayName = "ConnectionsGridList";
        return Component;
    }, []);

    const GridItem = useMemo(() => {
        const Component = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
            <div {...props} ref={ref} className="h-full" />
        ));
        Component.displayName = "ConnectionsGridItem";
        return Component;
    }, []);

    // Flatten all pages
    const connections = useMemo(() => {
        return connectionsData?.pages.flatMap(page => page.items) || [];
    }, [connectionsData]);

    const stats = statsData || {
        totalConnections: 0,
        pendingSent: 0,
        connectionsThisMonth: 0,
        connectionsGained: 0,
        pendingIncoming: 0
    };

    const handleDisconnect = async (connectionId: string, userName: string) => {
        if (!confirm(`Are you sure you want to disconnect from ${userName}?`)) return;

        toast.promise(disconnect.mutateAsync(connectionId), {
            loading: 'Disconnecting...',
            success: 'Disconnected',
            error: 'Failed to disconnect'
        });
    };

    const handleMessage = (userId: string) => {
        router.push(`/messages?userId=${userId}`);
    };

    if (connectionsLoading && !connectionsData) {
        return (
            <div className={cn(!embedded && "max-w-7xl mx-auto")}>
                 <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded w-64" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-24 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
                        ))}
                    </div>
                    <div className="h-10 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-32 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={cn(!embedded && "max-w-7xl mx-auto")}>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <UserCheck className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        {statsLoading ? "-" : stats.totalConnections}
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Total Connections</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <SendHorizontal className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        {statsLoading ? "-" : stats.pendingSent}
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Sent Requests</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <CalendarDays className="w-5 h-5 text-green-500" />
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        {statsLoading ? "-" : stats.connectionsThisMonth}
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">This Month</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-5 h-5 text-purple-500" />
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        +{statsLoading ? "-" : stats.connectionsGained}
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Gained</div>
                </div>
            </div>

            {/* Search */}
            <div className="mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search your connections..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        aria-label="Search connections"
                    />
                </div>
            </div>

            {/* Connections Grid */}
            {connections.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                    <Users className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400">
                        {searchQuery ? "No connections match your search." : "No connections yet."}
                    </p>
                    {!searchQuery && (
                        <Link href="/people?tab=discover" className="text-indigo-600 hover:underline mt-2 inline-block">
                            Discover people to connect with
                        </Link>
                    )}
                </div>
            ) : (
                <div style={{ height: '600px' }}>
                    <VirtuosoGrid
                        useWindowScroll
                        data={connections}
                        endReached={() => {
                            if (hasNextPage && !isFetchingNextPage) {
                                fetchNextPage();
                            }
                        }}
                        components={{
                            List: GridList,
                            Item: GridItem,
                            Footer: () => isFetchingNextPage ? (
                                <div className="col-span-full flex justify-center py-4">
                                    <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                                </div>
                            ) : null
                        }}
                        itemContent={(_, conn) => {
                            const user = conn.otherUser;
                            if (!user) return null;

                            const isProcessing = disconnect.isPending && disconnect.variables === conn.id;

                            return (
                                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:shadow-lg transition-shadow h-full">
                                    <div className="flex items-start gap-3">
                                        <Link href={profileHref(user)} className="flex-shrink-0">
                                            {user.avatarUrl ? (
                                                <Image
                                                    src={user.avatarUrl}
                                                    alt={user.fullName || user.username || "User"}
                                                    width={48}
                                                    height={48}
                                                    className="w-12 h-12 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                                                    {(user.fullName || user.username || "U")[0]?.toUpperCase()}
                                                </div>
                                            )}
                                        </Link>
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                href={profileHref(user)}
                                                className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors block truncate"
                                            >
                                                {user.fullName || user.username || "User"}
                                            </Link>
                                            {user.username && (
                                                <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">@{user.username}</p>
                                            )}
                                            {user.headline && (
                                                <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1 mt-1">{user.headline}</p>
                                            )}
                                            {conn.updatedAt && (
                                                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                                    Connected {formatDistanceToNow(new Date(conn.updatedAt), { addSuffix: true })}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 mt-4">
                                        <button
                                            onClick={() => handleMessage(user.id)}
                                            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
                                        >
                                            <MessageSquare className="w-4 h-4" />
                                            Message
                                        </button>
                                        <button
                                            onClick={() => handleDisconnect(conn.id, user.fullName || user.username || "this user")}
                                            disabled={isProcessing}
                                            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 transition-colors disabled:opacity-50"
                                            title="Disconnect"
                                        >
                                            {isProcessing ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <X className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        }}
                    />
                </div>
            )}
        </div>
    );
}
