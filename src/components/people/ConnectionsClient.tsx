"use client";

import { useState, forwardRef, useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
    Search, Users, MessageSquare, X, Loader2,
    TrendingUp, UserCheck, CalendarDays, ArrowUpRight,
    MoreHorizontal
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VirtuosoGrid } from "react-virtuoso";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { profileHref } from "@/lib/routing/identifiers";
import { useConnections, useConnectionStats, useConnectionMutations } from "@/hooks/useConnections";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";

interface ConnectionsClientProps {
    initialUser?: { id?: string | null } | null;
    embedded?: boolean;
}

type SortOption = "recent" | "name" | "oldest";

export default function ConnectionsClient({
    embedded = false
}: ConnectionsClientProps) {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [sortBy, setSortBy] = useState<SortOption>("recent");

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
            <div {...props} ref={ref} className="space-y-3 pb-8" />
        ));
        Component.displayName = "ConnectionsListLayout";
        return Component;
    }, []);

    const GridItem = useMemo(() => {
        const Component = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
            <div {...props} ref={ref} />
        ));
        Component.displayName = "ConnectionsListItem";
        return Component;
    }, []);

    // Flatten all pages once, then derive sorted views.
    const rawConnections = useMemo(
        () => connectionsData?.pages.flatMap((page) => page.items) || [],
        [connectionsData]
    );

    const validConnections = useMemo(
        () => rawConnections.filter((item) => Boolean(item.otherUser)),
        [rawConnections]
    );

    const connections = useMemo(() => {
        const items = validConnections;
        if (sortBy === "name") {
            return [...items].sort((a, b) => {
                const nameA = a.otherUser?.fullName || a.otherUser?.username || "";
                const nameB = b.otherUser?.fullName || b.otherUser?.username || "";
                return nameA.localeCompare(nameB);
            });
        }
        if (sortBy === "oldest") {
            return [...items].sort((a, b) =>
                new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
            );
        }
        return items; // "recent" keeps server order
    }, [validConnections, sortBy]);

    const stats = statsData || {
        totalConnections: 0,
        pendingSent: 0,
        connectionsThisMonth: 0,
        connectionsGained: 0,
        pendingIncoming: 0
    };

    const [disconnectTarget, setDisconnectTarget] = useState<{ id: string; name: string } | null>(null);

    const confirmDisconnect = useCallback(() => {
        if (!disconnectTarget) return;
        toast.promise(disconnect.mutateAsync(disconnectTarget.id), {
            loading: 'Disconnecting...',
            success: 'Disconnected',
            error: 'Failed to disconnect'
        });
    }, [disconnect, disconnectTarget]);

    const handleDisconnect = (connectionId: string, userName: string) => {
        setDisconnectTarget({ id: connectionId, name: userName });
    };

    const handleMessage = (userId: string) => {
        router.push(`/messages?userId=${userId}`);
    };

    // Recently connected (always latest by updatedAt, independent from active sort UI)
    const recentConnections = useMemo(
        () =>
            [...validConnections]
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .slice(0, 5),
        [validConnections]
    );

    const connectionsGrowth = useMemo(() => {
        const candidate = (statsData as { connectionsGrowth?: number[] } | undefined)?.connectionsGrowth;
        if (!Array.isArray(candidate)) return [] as number[];
        return candidate
            .filter((value): value is number => Number.isFinite(value))
            .map((value) => Math.max(0, Math.min(100, value)));
    }, [statsData]);

    if (connectionsLoading && !connectionsData) {
        return (
            <div className={cn(!embedded && "max-w-7xl mx-auto")}>
                <div className="space-y-4 animate-pulse">
                    {/* Stats strip skeleton */}
                    <div className="flex gap-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-14 flex-1 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                        ))}
                    </div>
                    {/* Search skeleton */}
                    <div className="h-12 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                    {/* Split layout skeleton */}
                    <div className="flex gap-6">
                        <div className="flex-[3] space-y-3">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="h-20 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                            ))}
                        </div>
                        <div className="flex-[2] hidden lg:block space-y-3">
                            <div className="h-48 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                            <div className="h-36 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (<>
        <div className={cn(!embedded && "max-w-7xl mx-auto")}>
            {/* ── COMPACT STATS STRIP ── */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                        <UserCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                            {statsLoading ? "–" : stats.totalConnections}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Connections</div>
                    </div>
                </div>
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
                        <CalendarDays className="w-4 h-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                        <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                            {statsLoading ? "–" : `+${stats.connectionsThisMonth}`}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">This Month</div>
                    </div>
                </div>
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5">
                    <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                            {statsLoading ? "–" : `+${stats.connectionsGained}`}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Gained</div>
                    </div>
                </div>
            </div>

            {/* ── SEARCH + SORT/FILTER BAR ── */}
            <div className="flex items-center gap-3 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search your connections..."
                        className="w-full pl-12 pr-4 py-3 rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all"
                        aria-label="Search connections"
                    />
                </div>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="px-4 py-3 rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500/40 transition-all appearance-none cursor-pointer"
                >
                    <option value="recent">Recently Connected</option>
                    <option value="name">Alphabetical</option>
                    <option value="oldest">Oldest First</option>
                </select>
            </div>

            {/* ── SPLIT LAYOUT ── */}
            {connections.length === 0 ? (
                <div className="text-center py-16 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5">
                    <Users className="w-14 h-14 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400 text-lg font-medium">
                        {searchQuery ? "No connections match your search." : "No connections yet."}
                    </p>
                    {!searchQuery && (
                        <Link href="/people?tab=discover" className="text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block text-sm">
                            Discover people to connect with
                        </Link>
                    )}
                </div>
            ) : (
                <div className="flex gap-6">
                    {/* ── LEFT: CONNECTION LIST (60%) ── */}
                    <div className="flex-[3] min-w-0">
                        <div style={{ minHeight: 400 }}>
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
                                        <div className="flex justify-center py-4">
                                            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                                        </div>
                                    ) : null
                                }}
                                itemContent={(_, conn) => {
                                    const user = conn.otherUser;
                                    if (!user) {
                                        return (
                                            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-4">
                                                <p className="text-sm text-zinc-500 dark:text-zinc-400">Connection unavailable.</p>
                                            </div>
                                        );
                                    }
                                    const isProcessing = disconnect.isPending && disconnect.variables === conn.id;

                                    return (
                                        <div className="group rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-4 hover:shadow-lg hover:border-indigo-200/60 dark:hover:border-indigo-500/20 transition-all">
                                            <div className="flex items-center gap-4">
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
                                                    <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                                                        {user.username && <span className="truncate">@{user.username}</span>}
                                                        {user.headline && (
                                                            <>
                                                                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                                                                <span className="truncate">{user.headline}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                    {conn.updatedAt && (
                                                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                                                            Connected {formatDistanceToNow(new Date(conn.updatedAt), { addSuffix: true })}
                                                        </p>
                                                    )}
                                                </div>
                                                {/* Action buttons */}
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleMessage(user.id)}
                                                        className="p-2.5 rounded-xl border border-zinc-200/60 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all"
                                                        title="Message"
                                                    >
                                                        <MessageSquare className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDisconnect(conn.id, user.fullName || user.username || "this user")}
                                                        disabled={isProcessing}
                                                        className="p-2.5 rounded-xl border border-zinc-200/60 dark:border-white/10 text-zinc-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 hover:border-red-200 dark:hover:border-red-500/30 transition-all disabled:opacity-50"
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
                                        </div>
                                    );
                                }}
                            />
                        </div>
                    </div>

                    {/* ── RIGHT: INSIGHTS SIDEBAR (40%) ── */}
                    <div className="flex-[2] hidden lg:block space-y-4 sticky top-36 self-start">
                        {/* Connection Growth */}
                        <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendingUp className="w-4 h-4 text-indigo-500" />
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Connection Growth</h3>
                            </div>
                            {connectionsGrowth.length > 0 ? (
                                <>
                                    <div className="flex items-end gap-1 h-16 px-1">
                                        {connectionsGrowth.map((height, i) => (
                                            <div
                                                key={`${height}-${i}`}
                                                className="flex-1 rounded-sm bg-gradient-to-t from-indigo-500/30 to-indigo-500/80 dark:from-indigo-500/20 dark:to-indigo-500/60 transition-all hover:from-indigo-500/50 hover:to-indigo-600"
                                                style={{ height: `${height}%` }}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex justify-between mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                                        <span>History</span>
                                        <span>Now</span>
                                    </div>
                                </>
                            ) : (
                                <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-4 text-xs text-zinc-500 dark:text-zinc-400">
                                    Historical growth chart is coming soon.
                                </div>
                            )}
                        </div>

                        {/* Recently Connected */}
                        <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <CalendarDays className="w-4 h-4 text-green-500" />
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recently Connected</h3>
                            </div>
                            <div className="space-y-3">
                                {recentConnections.slice(0, 4).map((conn) => {
                                    const user = conn.otherUser;
                                    if (!user) return null;
                                    return (
                                        <Link
                                            key={conn.id}
                                            href={profileHref(user)}
                                            className="flex items-center gap-3 group/item"
                                        >
                                            {user.avatarUrl ? (
                                                <Image
                                                    src={user.avatarUrl}
                                                    alt={user.fullName || "User"}
                                                    width={32}
                                                    height={32}
                                                    className="w-8 h-8 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold">
                                                    {(user.fullName || user.username || "U")[0]?.toUpperCase()}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate group-hover/item:text-indigo-600 dark:group-hover/item:text-indigo-400 transition-colors">
                                                    {user.fullName || user.username || "User"}
                                                </p>
                                                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                                                    {conn.updatedAt ? formatDistanceToNow(new Date(conn.updatedAt), { addSuffix: true }) : ""}
                                                </p>
                                            </div>
                                            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 group-hover/item:text-indigo-500 transition-colors" />
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <MoreHorizontal className="w-4 h-4 text-amber-500" />
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Quick Actions</h3>
                            </div>
                            <div className="space-y-2">
                                <Link
                                    href="/people?tab=discover"
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
                                >
                                    <Users className="w-4 h-4" />
                                    Discover new people
                                </Link>
                                <Link
                                    href="/people?tab=requests"
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
                                >
                                    <MessageSquare className="w-4 h-4" />
                                    View pending requests
                                </Link>
                                <Link
                                    href="/messages"
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
                                >
                                    <MessageSquare className="w-4 h-4" />
                                    Open messages
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
        <ConfirmDialog
            open={!!disconnectTarget}
            onOpenChange={(open) => { if (!open) setDisconnectTarget(null); }}
            title="Disconnect"
            description={`Are you sure you want to disconnect from ${disconnectTarget?.name ?? ''}?`}
            confirmLabel="Disconnect"
            variant="destructive"
            onConfirm={confirmDisconnect}
        />
    </>);
}
