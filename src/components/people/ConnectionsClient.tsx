"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import {
    Search, Users, MessageSquare, X, Loader2, ChevronDown,
    TrendingUp, UserCheck, CalendarDays, Tag,
    CheckSquare, Square, Briefcase, ExternalLink, Check,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import PersonCard from "@/components/people/PersonCard";
import ProfilePreviewDrawer from "@/components/people/ProfilePreviewDrawer";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { useConnections, useConnectionStats, useConnectionMutations } from "@/hooks/useConnections";
import type { NetworkConnectionItem } from "@/hooks/useConnections";
import type { SuggestedProfile } from "@/app/actions/connections";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { resolveRelationshipActionModel } from "@/components/people/person-card-model";
import { profileHref } from "@/lib/routing/identifiers";

// ── Types ────────────────────────────────────────────────────────────

interface ConnectionsClientProps {
    initialUser?: { id?: string | null } | null;
}

type SortOption = "recent" | "name" | "oldest";
const MAX_BULK_SELECTION = 50;

// ── Component ────────────────────────────────────────────────────────

export default function ConnectionsClient(_props: ConnectionsClientProps) {
    void _props;
    const router = useRouter();
    const prefetch = useRouteWarmPrefetch();

    // Search & sort
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [sortBy, setSortBy] = useState<SortOption>("recent");

    // Scroll parent for Virtuoso
    const [routeScrollParent, setRouteScrollParent] = useState<HTMLElement | null>(() => {
        if (typeof document === "undefined") return null;
        return document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]");
    });

    useEffect(() => {
        setRouteScrollParent(document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"));
    }, []);

    // Selection mode (#16)
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Tag filter (#15)
    const [tagFilter, setTagFilter] = useState<string | null>(null);

    // Profile preview drawer (#14, Phase 5)
    const [previewProfile, setPreviewProfile] = useState<SuggestedProfile | null>(null);

    // Data hooks — server-side sort (#18), staleTime 30s (#20)
    const {
        data: connectionsData,
        isLoading: connectionsLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useConnections(50, debouncedSearch, sortBy);

    const { data: statsData, isLoading: statsLoading } = useConnectionStats();
    const { disconnect } = useConnectionMutations();

    // Flatten pages — no client-side sort needed (#18)
    const connections = useMemo(() => {
        const items = connectionsData?.pages.flatMap((page) => page.items) || [];
        const valid = items.filter((item) => Boolean(item.otherUser));

        // Client-side tag filter (#15)
        if (tagFilter) {
            return valid.filter((item) => item.tags?.includes(tagFilter));
        }
        return valid;
    }, [connectionsData, tagFilter]);

    // Collect unique tags for filter dropdown (#15)
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        const items = connectionsData?.pages.flatMap((page) => page.items) || [];
        for (const item of items) {
            if (item.tags) {
                for (const tag of item.tags) tagSet.add(tag);
            }
        }
        return Array.from(tagSet).sort();
    }, [connectionsData]);

    const stats = statsData || {
        totalConnections: 0,
        pendingSent: 0,
        connectionsThisMonth: 0,
        connectionsGained: 0,
        pendingIncoming: 0,
    };

    // Disconnect
    const [disconnectTarget, setDisconnectTarget] = useState<{ id: string; name: string } | null>(null);

    const confirmDisconnect = useCallback(() => {
        if (!disconnectTarget) return;
        toast.promise(
            disconnect.mutateAsync(disconnectTarget.id).then(() => {
                setDisconnectTarget(null);
            }),
            {
                loading: "Disconnecting...",
                success: "Disconnected",
                error: "Failed to disconnect",
            },
        );
    }, [disconnect, disconnectTarget]);

    const handleDisconnect = useCallback((connectionId: string, userName: string) => {
        setDisconnectTarget({ id: connectionId, name: userName });
    }, []);

    // Message with prefetch (#21)
    const handleMessage = useCallback((userId: string) => {
        router.push(`/messages?userId=${userId}`);
    }, [router]);

    const handleMessagePrefetch = useCallback((userId: string) => {
        prefetch(`/messages?userId=${userId}`);
    }, [prefetch]);

    // Selection mode handlers (#16)
    const toggleSelection = useCallback((userId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    }, []);

    const handleBulkMessage = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (selectedIds.size > MAX_BULK_SELECTION) {
            toast.error(`Please select ${MAX_BULK_SELECTION} or fewer connections`);
            return;
        }
        const ids = Array.from(selectedIds).join(",");
        router.push(`/messages?userIds=${ids}`);
        setSelectionMode(false);
        setSelectedIds(new Set());
    }, [selectedIds, router]);

    // 4F: Profile preview — enrich with skills/interests/bio
    const openPreview = useCallback((conn: NetworkConnectionItem) => {
        const user = conn.otherUser;
        if (!user) return;
        setPreviewProfile({
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            avatarUrl: user.avatarUrl,
            headline: user.headline,
            location: user.location,
            connectionStatus: "connected" as const,
            connectionId: conn.id,
            canConnect: false,
            skills: user.skills,
            interests: user.interests,
            openTo: user.openTo,
            messagePrivacy: user.messagePrivacy,
            canSendMessage: user.canSendMessage,
            lastActiveAt: user.lastActiveAt,
        });
    }, []);

    // ── Loading skeleton ────────────────────────────────────────────
    if (connectionsLoading && !connectionsData) {
        return (
            <div className="max-w-4xl mx-auto">
                <div className="space-y-4 animate-pulse">
                    <div className="flex gap-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-16 flex-1 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                        ))}
                    </div>
                    <div className="h-12 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={i} className="h-[72px] bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="max-w-4xl mx-auto">
                {/* ── Stats Row ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5">
                        <div className="w-9 h-9 rounded-full bg-primary/10 dark:bg-primary/15 flex items-center justify-center shrink-0">
                            <UserCheck className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                                {statsLoading ? "–" : stats.totalConnections}
                            </div>
                            <div className="text-[11px] text-zinc-500 font-medium">Connections</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5">
                        <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center shrink-0">
                            <CalendarDays className="w-4 h-4 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                                {statsLoading ? "–" : `+${stats.connectionsThisMonth}`}
                            </div>
                            <div className="text-[11px] text-zinc-500 font-medium">This Month</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 col-span-2 sm:col-span-1">
                        <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center shrink-0">
                            <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                                {statsLoading ? "–" : `+${stats.connectionsGained}`}
                            </div>
                            <div className="text-[11px] text-zinc-500 font-medium">Gained</div>
                        </div>
                    </div>
                </div>

                {/* ── Search + Sort + Tag Filter + Selection ── */}
                <div className="flex items-center gap-3 mb-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search your connections..."
                            className="w-full pl-12 pr-4 py-3 rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl focus:ring-2 focus:ring-ring/40 focus:border-primary/40 transition-all"
                            aria-label="Search connections"
                        />
                    </div>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        aria-label="Sort connections"
                        className="px-4 py-3 rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-ring/40 transition-all appearance-none cursor-pointer"
                    >
                        <option value="recent">Recently Connected</option>
                        <option value="name">Alphabetical</option>
                        <option value="oldest">Oldest First</option>
                    </select>
                    <button
                        type="button"
                        onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
                        className={cn(
                            "px-3 py-3 rounded-2xl border text-sm font-medium transition-all",
                            selectionMode
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                        )}
                        title="Select connections"
                    >
                        <CheckSquare className="w-4 h-4" />
                    </button>
                </div>

                {/* 4H: Search result count */}
                {debouncedSearch && connections.length > 0 && (
                    <p className="text-xs text-zinc-500 mb-2 ml-1">{connections.length} connection{connections.length !== 1 ? "s" : ""} found</p>
                )}

                {/* Tag filter chips (#15) */}
                {allTags.length > 0 && (
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                        <Tag className="w-3.5 h-3.5 text-zinc-400" />
                        <Badge
                            variant={tagFilter === null ? "default" : "outline"}
                            className="cursor-pointer text-xs"
                            onClick={() => setTagFilter(null)}
                        >
                            All
                        </Badge>
                        {allTags.map((tag) => (
                            <Badge
                                key={tag}
                                variant={tagFilter === tag ? "default" : "outline"}
                                className="cursor-pointer text-xs"
                                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                            >
                                {tag}
                            </Badge>
                        ))}
                    </div>
                )}

                {/* ── Bulk action bar (#16) ── */}
                {selectionMode && selectedIds.size > 0 && (
                    <div className="sticky bottom-4 z-30 mx-auto max-w-sm mb-4">
                        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-lg">
                            <span className="text-sm font-medium">{selectedIds.size} selected</span>
                            <button
                                type="button"
                                onClick={handleBulkMessage}
                                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 dark:bg-zinc-900/20 text-sm font-medium hover:bg-white/30 dark:hover:bg-zinc-900/30 transition-colors"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                                Message
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Connection List ── */}
                {connections.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={searchQuery ? "No connections match your search." : tagFilter ? "No connections with this tag." : "No connections yet."}
                        action={
                            !searchQuery && !tagFilter ? (
                                <Link href="/people?tab=discover" className="text-primary hover:underline text-sm">
                                    Discover people to connect with
                                </Link>
                            ) : undefined
                        }
                    />
                ) : (
                    <div style={{ minHeight: 400 }}>
                        <Virtuoso
                            customScrollParent={routeScrollParent ?? undefined}
                            increaseViewportBy={600}
                            data={connections}
                            endReached={() => {
                                if (hasNextPage && !isFetchingNextPage) fetchNextPage();
                            }}
                            itemContent={(_index, conn) => {
                                const user = conn.otherUser;
                                if (!user) return null;

                                const isProcessing = disconnect.isPending && disconnect.variables === conn.id;
                                const isSelected = selectedIds.has(user.id);
                                const mappedProfile: SuggestedProfile = {
                                    id: user.id,
                                    username: user.username,
                                    fullName: user.fullName,
                                    avatarUrl: user.avatarUrl,
                                    headline: user.headline,
                                    location: user.location,
                                    connectionStatus: "connected" as const,
                                    connectionId: conn.id,
                                    canConnect: false,
                                    skills: user.skills,
                                    interests: user.interests,
                                    tags: conn.tags,
                                    openTo: user.openTo,
                                    messagePrivacy: user.messagePrivacy,
                                    canSendMessage: user.canSendMessage,
                                    lastActiveAt: user.lastActiveAt,
                                };
                                const messageHref = `/messages?userId=${user.id}`;
                                const profileLink = profileHref(mappedProfile);
                                const inviteHref = `${profileLink}#profile-collaboration`;
                                const actionModel = resolveRelationshipActionModel({
                                    state: "connected",
                                    canSendMessage: Boolean(user.canSendMessage),
                                    profileHref: profileLink,
                                    messageHref,
                                    inviteHref,
                                });

                                return (
                                    <div className="mb-3 flex items-center gap-2">
                                        {/* Selection checkbox (#16) */}
                                        {selectionMode && (
                                            <button
                                                type="button"
                                                onClick={() => toggleSelection(user.id)}
                                                className="p-1 flex-shrink-0"
                                                aria-label={`${isSelected ? "Deselect" : "Select"} ${user.fullName || user.username || user.id}`}
                                                aria-pressed={isSelected}
                                            >
                                                {isSelected ? (
                                                    <CheckSquare className="w-5 h-5 text-primary" />
                                                ) : (
                                                    <Square className="w-5 h-5 text-zinc-400" />
                                                )}
                                            </button>
                                        )}
                                        <div
                                            className="flex-1 cursor-pointer"
                                            role="button"
                                            tabIndex={selectionMode ? -1 : 0}
                                            onClick={() => !selectionMode && openPreview(conn)}
                                            onKeyDown={(event) => {
                                                if (!selectionMode && (event.key === "Enter" || event.key === " ")) {
                                                    event.preventDefault();
                                                    openPreview(conn);
                                                }
                                            }}
                                        >
                                            <PersonCard
                                                profile={mappedProfile}
                                                onConnect={async () => {}}
                                                variant="network"
                                                connectedAt={conn.updatedAt}
                                                actions={
                                                    <>
                                                        {/* Active indicator (#13) */}
                                                        {conn.isActive && (
                                                            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 flex-shrink-0" title="Active connection" />
                                                        )}

                                                        {actionModel.canSendMessage && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    handleMessage(user.id);
                                                                }}
                                                                onMouseEnter={() => handleMessagePrefetch(user.id)}
                                                                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200"
                                                                aria-label={`Message ${user.fullName || user.username || "connection"}`}
                                                            >
                                                                <MessageSquare className="w-3.5 h-3.5" />
                                                                Message
                                                            </button>
                                                        )}
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200"
                                                                    aria-label={`Open connection actions for ${user.fullName || user.username || "connection"}`}
                                                                >
                                                                    <Check className="w-3.5 h-3.5" />
                                                                    Connected
                                                                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-52">
                                                                {actionModel.connectedMenu.map((action, index) => {
                                                                    if (action.key === "disconnect") {
                                                                        return (
                                                                            <React.Fragment key={action.key}>
                                                                                {index > 0 && <DropdownMenuSeparator />}
                                                                                <DropdownMenuItem
                                                                                    onClick={(e) => {
                                                                                        e.preventDefault();
                                                                                        e.stopPropagation();
                                                                                        handleDisconnect(conn.id, user.fullName || user.username || "this user");
                                                                                    }}
                                                                                    disabled={isProcessing}
                                                                                    variant="destructive"
                                                                                >
                                                                                    {isProcessing ? (
                                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                                    ) : (
                                                                                        <X className="w-4 h-4" />
                                                                                    )}
                                                                                    Disconnect
                                                                                </DropdownMenuItem>
                                                                            </React.Fragment>
                                                                        );
                                                                    }

                                                                    if (!action.href) return null;
                                                                    const icon = action.key === "message"
                                                                        ? <MessageSquare className="w-4 h-4" />
                                                                        : action.key === "invite_to_project"
                                                                            ? <Briefcase className="w-4 h-4" />
                                                                            : <ExternalLink className="w-4 h-4" />;

                                                                    return (
                                                                        <DropdownMenuItem key={action.key} asChild>
                                                                            <Link href={action.href}>
                                                                                {icon}
                                                                                {action.label}
                                                                            </Link>
                                                                        </DropdownMenuItem>
                                                                    );
                                                                })}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </>
                                                }
                                            />
                                        </div>
                                    </div>
                                );
                            }}
                            components={{
                                Footer: () => isFetchingNextPage ? (
                                    <div className="flex justify-center py-6">
                                        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                                    </div>
                                ) : null,
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Disconnect confirm dialog */}
            <ConfirmDialog
                open={!!disconnectTarget}
                onOpenChange={(open) => { if (!open) setDisconnectTarget(null); }}
                title="Disconnect"
                description={`Are you sure you want to disconnect from ${disconnectTarget?.name ?? ""}?`}
                confirmLabel="Disconnect"
                variant="destructive"
                onConfirm={confirmDisconnect}
            />

            {/* Profile preview drawer (#14, Phase 5) */}
            <ProfilePreviewDrawer
                open={!!previewProfile}
                onOpenChange={(open) => { if (!open) setPreviewProfile(null); }}
                profile={previewProfile}
            />
        </>
    );
}
