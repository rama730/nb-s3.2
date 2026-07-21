"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, Loader2, MapPin, MessageSquare, UserCheck, UserMinus, Users } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConnectionMutations, useConnections, type NetworkConnectionItem } from "@/hooks/useConnections";
import { profileHref } from "@/lib/routing/identifiers";
import { formatDistanceToNow } from "date-fns";
import { useDebounce } from "use-debounce";

type SortOption = "recent" | "name" | "oldest";

export default function ConnectionsClient({
    searchQuery,
}: {
    searchQuery: string;
}) {
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [sortBy, setSortBy] = useState<SortOption>("recent");
    const [routeScrollParent, setRouteScrollParent] = useState<HTMLElement | null>(() =>
        typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"),
    );

    useEffect(() => {
        setRouteScrollParent(document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"));
    }, []);

    const {
        data: connectionsData,
        isLoading: connectionsLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useConnections(50, debouncedSearch, sortBy);
    const { disconnect, blockProfile } = useConnectionMutations();

    const connections = useMemo(
        () => (connectionsData?.pages.flatMap((page) => page.items) ?? []).filter((item) => Boolean(item.otherUser)),
        [connectionsData],
    );
    const totalConnections = connectionsData?.pages[0]?.stats.totalConnections ?? 0;
    const isInitialLoading = connectionsLoading && !connectionsData;

    const handleDisconnect = useCallback((connectionId: string) => {
        const request = disconnect.mutateAsync(connectionId).then(() => undefined);
        void toast.promise(request, {
            loading: "Disconnecting...",
            success: "Disconnected",
            error: (error) => error instanceof Error ? error.message : "Failed to disconnect",
        });
        return request;
    }, [disconnect]);

    const handleBlock = useCallback((userId: string) => {
        const request = blockProfile.mutateAsync(userId).then(() => undefined);
        void toast.promise(request, {
            loading: "Blocking profile...",
            success: "Profile blocked",
            error: (error) => error instanceof Error ? error.message : "Failed to block profile",
        });
        return request;
    }, [blockProfile]);

    return <div className="max-w-4xl mx-auto">
        <Stat icon={UserCheck} label="Connections" value={totalConnections} />

        <div className="mb-4 flex justify-end">
            <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortOption)}
                aria-label="Sort connections"
                className="cursor-pointer appearance-none rounded-2xl border border-zinc-200/60 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-700 backdrop-blur-xl transition-all   dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-300"
            >
                <option value="recent">Recently Connected</option>
                <option value="name">Alphabetical</option>
                <option value="oldest">Oldest First</option>
            </select>
        </div>

        {debouncedSearch && connections.length > 0 ? <p className="mb-2 ml-1 text-xs text-zinc-500">{connections.length} connection{connections.length === 1 ? "" : "s"} found</p> : null}

        {isInitialLoading ? <div className="space-y-3 animate-pulse">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-[72px] rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50" />)}</div> : connections.length === 0 ? <EmptyState
            icon={Users}
            title={searchQuery ? "No connections match your search." : "No connections yet."}
            action={!searchQuery ? <Link href="/people?tab=discover" className="text-primary hover:underline text-sm">Discover people to connect with</Link> : undefined}
        /> : <div style={{ minHeight: 400 }}>
            <Virtuoso
                customScrollParent={routeScrollParent ?? undefined}
                increaseViewportBy={600}
                data={connections}
                endReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
                itemContent={(_, connection) => <NetworkRow connection={connection} onDisconnect={handleDisconnect} onBlock={handleBlock} />}
                components={{ Footer: () => isFetchingNextPage ? <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div> : null }}
            />
        </div>}
    </div>;
}

function NetworkRow({ connection, onDisconnect, onBlock }: { connection: NetworkConnectionItem; onDisconnect: (id: string) => Promise<void>; onBlock: (id: string) => Promise<void> }) {
    const user = connection.otherUser;
    if (!user) return null;
    const name = user.fullName || user.username || "User";
    return <div className="mb-3 flex items-center gap-4 rounded-2xl border border-zinc-200/60 bg-white/80 p-4 backdrop-blur-xl transition-colors hover:border-zinc-300 dark:border-white/5 dark:bg-zinc-900/80 dark:hover:border-zinc-700">
        <Link href={profileHref(user)}><UserAvatar identity={user} size={40} /></Link>
        <Link href={profileHref(user)} className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-zinc-900 hover:text-primary dark:text-zinc-100">{name}</h3>{user.headline ? <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{user.headline}</p> : null}{user.location ? <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400"><MapPin className="h-3 w-3" />{user.location}</p> : null}</Link>
        <p className="hidden text-xs text-zinc-400 sm:block">Connected {formatDistanceToNow(new Date(connection.updatedAt), { addSuffix: true })}</p>
        {user.canSendMessage ? <Link href={`/messages?userId=${user.id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200"><MessageSquare className="h-3.5 w-3.5" />Message</Link> : null}
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200" aria-label={`Open connection actions for ${name}`}><Check className="h-3.5 w-3.5" />Connected<ChevronDown className="h-3.5 w-3.5" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void onDisconnect(connection.id)} variant="destructive"><UserMinus className="h-4 w-4" />Disconnect</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void onBlock(user.id)} variant="destructive"><Ban className="h-4 w-4" />Block profile</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof UserCheck; label: string; value: number }) {
    return <div className="mb-6 flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-white/80 px-4 py-3 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-900/80">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/15"><Icon className="w-4 h-4" /></div>
        <div><div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">{value}</div><div className="text-[11px] font-medium text-zinc-500">{label}</div></div>
    </div>;
}
