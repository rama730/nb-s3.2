import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
    Loader2, UserPlus, X, Clock, CheckCheck, Briefcase,
    ChevronDown, ChevronRight, Inbox, History, UserMinus,
    ArrowDownLeft, ArrowUpRight, Ban, CheckCircle2, Users, MessageSquare, ExternalLink,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatDistanceToNow, isToday, isYesterday, subDays, isAfter } from "date-fns";
import { profileHref } from "@/lib/routing/identifiers";
import {
    usePendingRequests,
    useRequestHistory,
    useConnectionMutations,
    type PendingIncomingRequest,
    type PendingSentRequest,
    type RequestHistoryItem,
} from "@/hooks/useConnections";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { getAvatarGradient } from "@/lib/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PersonCard from "@/components/people/PersonCard";
import ProjectApplicationsSection from "./ProjectApplicationsSection";
import type { IncomingApplication, MyApplication } from "./ProjectApplicationsSection";
import { resolveRelationshipActionModel } from "@/components/people/person-card-model";

interface RequestsTabProps {
    initialUser: { id?: string | null } | null;
    initialRequests?: { incoming: PendingIncomingRequest[]; sent: PendingSentRequest[] };
    initialApplications?: { my: MyApplication[]; incoming: IncomingApplication[] };
}

// ── Status configuration ────────────────────────────────────────────

import { getLifecycleStatusStyle } from "@/lib/ui/status-config";

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
    pending: Clock,
    accepted: CheckCircle2,
    rejected: X,
    cancelled: Ban,
    disconnected: UserMinus,
    withdrawn: X,
    role_filled: CheckCircle2,
};

const REQUESTS_INITIAL_BATCH = 24;
const REQUESTS_BATCH_STEP = 24;
const HISTORY_INITIAL_BATCH = 20;
const HISTORY_BATCH_STEP = 20;

// ── History summary ─────────────────────────────────────────────────

function getHistorySummary(item: RequestHistoryItem) {
    if (item.source === "connection") {
        switch (item.status) {
            case "pending":
                return item.direction === "incoming"
                    ? "Sent you a connection request"
                    : "You sent a connection request";
            case "accepted":
                return item.direction === "incoming"
                    ? "Connection request accepted"
                    : "You connected";
            case "rejected":
                return item.direction === "incoming"
                    ? "You declined the request"
                    : "Your request was declined";
            case "cancelled":
                return item.direction === "outgoing"
                    ? "You cancelled the request"
                    : "Request was cancelled";
            case "disconnected":
                return "Connection was removed";
            default:
                return "Connection update";
        }
    }

    const safeRoleTitle = item.roleTitle || "a role";
    if ((item.status as string) === "cancelled") {
        return "Application was cancelled";
    }

    switch (item.status) {
        case "pending":
            return item.direction === "incoming"
                ? `Applied for ${safeRoleTitle}`
                : `You applied for ${safeRoleTitle}`;
        case "accepted":
            return item.direction === "incoming"
                ? "You accepted this application"
                : `Accepted for ${safeRoleTitle}`;
        case "rejected":
            return item.direction === "incoming"
                ? "You rejected this application"
                : "Application was rejected";
        case "withdrawn":
            return "Application was withdrawn";
        case "role_filled":
            return "Role was filled";
        default:
            return "Application update";
    }
}

// ── Time grouping ───────────────────────────────────────────────────

function groupHistoryByTime(items: RequestHistoryItem[]): { label: string; items: RequestHistoryItem[] }[] {
    const groups: { label: string; items: RequestHistoryItem[] }[] = [];
    const today: RequestHistoryItem[] = [];
    const yesterday: RequestHistoryItem[] = [];
    const lastWeek: RequestHistoryItem[] = [];
    const older: RequestHistoryItem[] = [];

    const weekAgo = subDays(new Date(), 7);

    for (const item of items) {
        const date = new Date(item.eventAt);
        if (isToday(date)) today.push(item);
        else if (isYesterday(date)) yesterday.push(item);
        else if (isAfter(date, weekAgo)) lastWeek.push(item);
        else older.push(item);
    }

    if (today.length > 0) groups.push({ label: "Today", items: today });
    if (yesterday.length > 0) groups.push({ label: "Yesterday", items: yesterday });
    if (lastWeek.length > 0) groups.push({ label: "This Week", items: lastWeek });
    if (older.length > 0) groups.push({ label: "Earlier", items: older });

    return groups;
}

// ── Timeline avatar ─────────────────────────────────────────────────

function TimelineAvatar({
    user,
    source,
    size = 36,
}: {
    user: { avatarUrl?: string | null; fullName?: string | null; username?: string | null } | null;
    source: "connection" | "application";
    size?: number;
}) {
    const sizeClass = size <= 32 ? "w-8 h-8" : "w-9 h-9";
    const textSize = size <= 32 ? "text-xs" : "text-sm";

    if (user?.avatarUrl) {
        return (
            <Image
                src={user.avatarUrl}
                alt={user.fullName || user.username || "User"}
                width={size}
                height={size}
                className={cn(sizeClass, "rounded-full object-cover flex-shrink-0")}
            />
        );
    }

    const initial = (user?.fullName || user?.username || (source === "application" ? "P" : "U"))[0]?.toUpperCase();
    const gradient = getAvatarGradient(user?.fullName || user?.username || "");

    return (
        <div className={cn(
            sizeClass,
            "rounded-full flex-shrink-0 flex items-center justify-center bg-gradient-to-br text-white font-semibold",
            textSize,
            gradient,
        )}>
            {source === "application" && !user ? (
                <Briefcase className="w-3.5 h-3.5" />
            ) : (
                initial
            )}
        </div>
    );
}

// ── Timeline item ───────────────────────────────────────────────────

function TimelineItem({ item, isLast }: { item: RequestHistoryItem; isLast: boolean }) {
    const config = getLifecycleStatusStyle(item.status);
    const StatusIcon = STATUS_ICONS[item.status] || Clock;
    const user = item.user;
    const isApplication = item.source === "application";
    const directionIcon = item.direction === "incoming" ? ArrowDownLeft : ArrowUpRight;
    const DirectionIcon = directionIcon;

    const primaryName = isApplication
        ? item.project?.title || "Unknown project"
        : user?.fullName || user?.username || "User";

    const secondaryName = isApplication
        ? (user?.fullName || user?.username || null)
        : null;

    return (
        <div className="relative flex gap-3 pb-6 last:pb-0">
            {/* Vertical connector */}
            {!isLast && (
                <div className="absolute left-[17px] top-[44px] bottom-0 w-px bg-zinc-200 dark:bg-zinc-800" />
            )}

            {/* Avatar column */}
            <div className="relative flex-shrink-0">
                <TimelineAvatar user={user} source={item.source} size={36} />
                {/* Status dot overlaid on avatar */}
                <div className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-900",
                    config.dotColor,
                )} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        {/* Primary line: name + direction + status */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {user ? (
                                <Link
                                    href={profileHref(user)}
                                    className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-primary dark:hover:text-primary transition-colors truncate"
                                >
                                    {primaryName}
                                </Link>
                            ) : (
                                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                    {primaryName}
                                </span>
                            )}
                            <DirectionIcon className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            <span className={cn("inline-flex items-center gap-1 text-xs font-medium flex-shrink-0", config.textColor)}>
                                <StatusIcon className="w-3 h-3" />
                                {config.label}
                            </span>
                        </div>

                        {/* Summary */}
                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                            {getHistorySummary(item)}
                        </p>

                        {/* Secondary info line */}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                            <span>{formatDistanceToNow(new Date(item.eventAt), { addSuffix: true })}</span>
                            {secondaryName && (
                                <>
                                    <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-700" />
                                    <span>{secondaryName}</span>
                                </>
                            )}
                            {isApplication && item.project?.slug && (
                                <>
                                    <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-700" />
                                    <Link
                                        href={`/projects/${item.project.slug}`}
                                        className="hover:text-primary transition-colors"
                                    >
                                        View project
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Request message preview (7A) ─────────────────────────────────────

function RequestMessagePreview({ message }: { message?: string | null }) {
    const [expanded, setExpanded] = useState(false);

    if (!message) return null;

    const truncated = message.length > 100;
    const displayText = expanded ? message : message.slice(0, 100);

    return (
        <div className="pl-14 pr-4 pb-3 -mt-2">
            <p className="text-xs text-zinc-400 italic">
                &ldquo;{displayText}{truncated && !expanded ? "..." : ""}&rdquo;
            </p>
            {truncated && (
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="text-[11px] text-primary hover:text-primary/80 font-medium mt-0.5 transition-colors"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            )}
        </div>
    );
}

// ── Collapsible section ─────────────────────────────────────────────

function CollapsibleSection({
    title,
    icon,
    open,
    onToggle,
    count,
    children,
    panelId,
}: {
    title: string;
    icon: React.ReactNode;
    open: boolean;
    onToggle: () => void;
    count?: number;
    children: React.ReactNode;
    panelId: string;
}) {
    return (
        <section>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={panelId}
                className="w-full flex items-center gap-2 mb-4 group"
            >
                <div className="flex items-center gap-2">
                    {icon}
                    <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors">
                        {title}
                    </h2>
                    {count != null && count > 0 && (
                        <span className="text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded-full">
                            {count}
                        </span>
                    )}
                </div>
                <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800 ml-2" />
                {open ? (
                    <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                )}
            </button>
            {open && <div id={panelId} role="region">{children}</div>}
        </section>
    );
}

// ── Main component ──────────────────────────────────────────────────

export default function RequestsTab({ initialUser, initialRequests, initialApplications }: RequestsTabProps) {
    const { data: requestData, isLoading: requestsLoading } = usePendingRequests();
    // 5I: Align limit with HISTORY_INITIAL_BATCH (20)
    const { data: requestHistoryData, isLoading: historyLoading, fetchNextPage: fetchMoreHistory, hasNextPage: hasMoreHistory, isFetchingNextPage: isFetchingMoreHistory } = useRequestHistory(HISTORY_INITIAL_BATCH);
    const { acceptRequest, rejectRequest, undoRejectRequest, cancelRequest, acceptAllIncoming, rejectAllIncoming, blockProfile } = useConnectionMutations();

    const [timelineOpen, setTimelineOpen] = useState(true);
    const [appsOpen, setAppsOpen] = useState(true);
    const [incomingLimit, setIncomingLimit] = useState(REQUESTS_INITIAL_BATCH);
    const [sentLimit, setSentLimit] = useState(REQUESTS_INITIAL_BATCH);
    const [historyLimit, setHistoryLimit] = useState(HISTORY_INITIAL_BATCH);
    const appsPanelId = "project-apps-panel";
    const timelinePanelId = "activity-timeline-panel";

    const incomingRequests = useMemo(() => {
        const raw = requestData?.incoming || initialRequests?.incoming || [];
        return [...raw].sort((a, b) => {
            const mutualDiff = (b.mutualCount ?? 0) - (a.mutualCount ?? 0);
            if (mutualDiff !== 0) return mutualDiff;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [requestData?.incoming, initialRequests?.incoming]);
    const sentRequests = useMemo(
        () => requestData?.sent || initialRequests?.sent || [],
        [requestData?.sent, initialRequests?.sent],
    );

    const isLoading = requestsLoading && !initialRequests && incomingRequests.length === 0 && sentRequests.length === 0;
    const historyItems = useMemo(
        () => requestHistoryData?.pages?.flatMap(page => page.items) ?? [],
        [requestHistoryData?.pages],
    );
    const visibleIncomingRequests = useMemo(() => incomingRequests.slice(0, incomingLimit), [incomingLimit, incomingRequests]);
    const visibleSentRequests = useMemo(() => sentRequests.slice(0, sentLimit), [sentLimit, sentRequests]);
    const visibleHistoryItems = useMemo(() => historyItems.slice(0, historyLimit), [historyItems, historyLimit]);
    // 7D: Partition history items by source type
    const connectionHistoryItems = useMemo(
        () => visibleHistoryItems.filter((item) => item.source === "connection"),
        [visibleHistoryItems],
    );
    const applicationHistoryItems = useMemo(
        () => visibleHistoryItems.filter((item) => item.source === "application"),
        [visibleHistoryItems],
    );
    const groupedConnectionHistory = useMemo(() => groupHistoryByTime(connectionHistoryItems), [connectionHistoryItems]);
    const groupedApplicationHistory = useMemo(() => groupHistoryByTime(applicationHistoryItems), [applicationHistoryItems]);

    const [connectionActivityOpen, setConnectionActivityOpen] = useState(true);
    const [applicationActivityOpen, setApplicationActivityOpen] = useState(true);
    const hasMoreIncoming = incomingRequests.length > visibleIncomingRequests.length;
    const hasMoreSent = sentRequests.length > visibleSentRequests.length;
    const hasMoreHistoryLocal = historyItems.length > visibleHistoryItems.length;
    const viewerId = initialUser?.id ?? null;
    const historyPageCount = requestHistoryData?.pages.length ?? 0;
    const previousHistoryPageCountRef = useRef(historyPageCount);
    const previousHistoryViewerIdRef = useRef(viewerId);
    const [requestRenderNowMs, setRequestRenderNowMs] = useState(() => Date.now());

    useEffect(() => { setIncomingLimit(REQUESTS_INITIAL_BATCH); }, [incomingRequests.length, viewerId]);
    useEffect(() => { setSentLimit(REQUESTS_INITIAL_BATCH); }, [sentRequests.length, viewerId]);
    useEffect(() => {
        const previousViewerId = previousHistoryViewerIdRef.current;
        const previousPageCount = previousHistoryPageCountRef.current;

        if (viewerId !== previousViewerId || historyPageCount < previousPageCount) {
            setHistoryLimit(HISTORY_INITIAL_BATCH);
        }

        previousHistoryViewerIdRef.current = viewerId;
        previousHistoryPageCountRef.current = historyPageCount;
    }, [historyPageCount, viewerId]);
    useEffect(() => { setRequestRenderNowMs(Date.now()); }, [incomingRequests.length, sentRequests.length, viewerId]);

    const handleAccept = async (id: string) => {
        toast.promise(acceptRequest.mutateAsync(id), {
            loading: "Accepting...",
            success: "Connection accepted!",
            error: "Failed to accept",
        });
    };

    const handleReject = async (id: string, reason?: string) => {
        const pendingToast = toast.loading("Rejecting...");
        try {
            const result = await rejectRequest.mutateAsync({ id, reason });
            toast.dismiss(pendingToast);
            if (result?.undoUntil) {
                // 5K: Compute undo duration from server clock
                const serverOffset = result.serverNow ? Date.now() - new Date(result.serverNow).getTime() : 0;
                const remainingMs = new Date(result.undoUntil).getTime() - (Date.now() - serverOffset);
                const toastDuration = Math.max(3000, Math.min(remainingMs, 20000));
                toast("Request declined", {
                    description: `Undo available for ${Math.ceil(toastDuration / 1000)} seconds.`,
                    duration: toastDuration,
                    action: {
                        label: "Undo",
                        onClick: () => {
                            void toast.promise(undoRejectRequest.mutateAsync(id), {
                                loading: "Restoring...",
                                success: "Request restored",
                                error: "Failed to restore request",
                            });
                        },
                    },
                });
            } else {
                toast.success("Request declined");
            }
        } catch {
            toast.dismiss(pendingToast);
            toast.error("Failed to decline");
        }
    };

    const handleCancel = async (id: string) => {
        toast.promise(cancelRequest.mutateAsync(id), {
            loading: "Cancelling...",
            success: "Request cancelled",
            error: "Failed to cancel",
        });
    };

    const handleBlock = async (targetUserId: string, displayName: string) => {
        toast.promise(blockProfile.mutateAsync(targetUserId), {
            loading: `Blocking ${displayName}...`,
            success: `${displayName} blocked`,
            error: "Failed to block account",
        });
    };

    const [bulkAction, setBulkAction] = useState<{ type: "accept" | "reject" } | null>(null);
    const bulkPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Clean up bulk polling on unmount
    useEffect(() => {
        return () => {
            if (bulkPollRef.current) clearTimeout(bulkPollRef.current);
        };
    }, []);

    // 5L: Exponential backoff polling for bulk actions
    const startBulkJobPolling = useCallback((jobId: string, count: number, action: "accept" | "reject") => {
        const toastId = toast.loading(`Processing ${count} requests...`);
        let elapsed = 0;
        let backoff = 1_000; // Start at 1s, double each time, cap at 15s
        const maxPollMs = 30_000;

        if (bulkPollRef.current) clearTimeout(bulkPollRef.current);

        const poll = async () => {
            elapsed += backoff;

            try {
                const res = await fetch(`/api/v1/connections/bulk-job-status?jobId=${encodeURIComponent(jobId)}`);
                const data = await res.json().catch(() => null);

                if (res.ok) {
                    if (data?.status === "completed") {
                        if (bulkPollRef.current) clearTimeout(bulkPollRef.current);
                        bulkPollRef.current = null;
                        toast.dismiss(toastId);
                        toast.success(`All ${count} requests ${action === "accept" ? "accepted" : "rejected"} successfully.`);
                        return;
                    }
                    if (data?.status === "failed") {
                        if (bulkPollRef.current) clearTimeout(bulkPollRef.current);
                        bulkPollRef.current = null;
                        toast.dismiss(toastId);
                        toast.error(`Bulk ${action} failed. Some requests may not have been processed.`);
                        return;
                    }
                }
            } catch {
                // Silently retry on network errors
            }

            if (elapsed >= maxPollMs) {
                if (bulkPollRef.current) clearTimeout(bulkPollRef.current);
                bulkPollRef.current = null;
                toast.dismiss(toastId);
                toast.info(`Bulk ${action} is still processing. Requests will update shortly.`);
                return;
            }

            backoff = Math.min(backoff * 2, 15_000);
            bulkPollRef.current = setTimeout(() => {
                void poll();
            }, backoff);
        };

        bulkPollRef.current = setTimeout(() => {
            void poll();
        }, backoff);
    }, []);

    const confirmAcceptAll = useCallback(async () => {
        const count = incomingRequests.length;
        const pendingToast = toast.loading("Accepting all requests...");
        try {
            const result = await acceptAllIncoming.mutateAsync(count);
            toast.dismiss(pendingToast);
            if (result.jobId) {
                startBulkJobPolling(result.jobId, count, "accept");
            } else {
                toast.success(result.queued ? "Accept all queued. Requests will update shortly." : "Accept all started.");
            }
        } catch {
            toast.dismiss(pendingToast);
            toast.error("Failed to accept all requests");
        }
    }, [acceptAllIncoming, incomingRequests.length, startBulkJobPolling]);

    const confirmRejectAll = useCallback(async () => {
        const count = incomingRequests.length;
        const pendingToast = toast.loading("Rejecting all requests...");
        try {
            const result = await rejectAllIncoming.mutateAsync(count);
            toast.dismiss(pendingToast);
            if (result.jobId) {
                startBulkJobPolling(result.jobId, count, "reject");
            } else {
                toast.success(result.queued ? "Reject all queued. Requests will update shortly." : "Reject all started.");
            }
        } catch {
            toast.dismiss(pendingToast);
            toast.error("Failed to reject all requests");
        }
    }, [rejectAllIncoming, incomingRequests.length, startBulkJobPolling]);

    // ── Loading skeleton ───────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-14 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => <div key={i} className="h-[80px] bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />)}
                </div>
                <div className="space-y-3">
                    {[1, 2].map((i) => <div key={i} className="h-[80px] bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />)}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* ── Summary Bar ── */}
            <div className="flex items-center justify-between p-4 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {incomingRequests.length}
                        </span>
                        <span className="text-sm text-zinc-500">incoming</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {sentRequests.length}
                        </span>
                        <span className="text-sm text-zinc-500">sent</span>
                    </div>
                </div>
                {incomingRequests.length > 1 && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setBulkAction({ type: "accept" })}
                            disabled={acceptAllIncoming.isPending || rejectAllIncoming.isPending}
                            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
                        >
                            <CheckCheck className="w-3.5 h-3.5" />
                            Accept all
                        </button>
                        <button
                            type="button"
                            onClick={() => setBulkAction({ type: "reject" })}
                            disabled={acceptAllIncoming.isPending || rejectAllIncoming.isPending}
                            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                        >
                            <X className="w-3.5 h-3.5" />
                            Reject all
                        </button>
                    </div>
                )}
            </div>

            {/* ── Combined empty state ── */}
            {incomingRequests.length === 0 && sentRequests.length === 0 && (
                <div className="text-center py-16 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5">
                    <Inbox className="w-14 h-14 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400 text-lg font-medium">No pending requests</p>
                    <Link href="/people?tab=discover" className="text-primary hover:underline mt-2 inline-block text-sm">
                        Discover people to connect with
                    </Link>
                </div>
            )}

            {/* ── Incoming Requests Section ── */}
            {incomingRequests.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-primary" />
                        Incoming
                    </h2>
                    <div className="space-y-3">
                        {visibleIncomingRequests.map((req) => {
                            const profile = {
                                id: req.requesterId,
                                username: req.requesterUsername,
                                fullName: req.requesterFullName,
                                avatarUrl: req.requesterAvatarUrl,
                                headline: req.requesterHeadline,
                                location: req.requesterLocation ?? null,
                                connectionStatus: "pending_received" as const,
                                canConnect: true,
                                mutualConnections: req.mutualCount ?? 0,
                                skills: req.requesterSkills ?? [],
                                openTo: req.requesterOpenTo ?? [],
                                messagePrivacy: req.requesterMessagePrivacy ?? "connections",
                                canSendMessage: req.requesterCanSendMessage ?? false,
                                lastActiveAt: req.requesterLastActiveAt ?? null,
                            };
                            const actionModel = resolveRelationshipActionModel({
                                state: "pending_received",
                                canSendMessage: Boolean(req.requesterCanSendMessage),
                                profileHref: profileHref(profile),
                                messageHref: `/messages?userId=${req.requesterId}`,
                                inviteHref: null,
                            });
                            const isAccepting = acceptRequest.isPending && acceptRequest.variables === req.id;
                            const isRejecting = rejectRequest.isPending && rejectRequest.variables?.id === req.id;
                            const isProcessing = isAccepting || isRejecting;

                            return (
                                <div key={req.id} className="space-y-0">
                                    <PersonCard
                                        profile={profile}
                                        onConnect={async () => handleAccept(req.id)}
                                        isConnecting={isProcessing}
                                        variant="request"
                                        requestedAt={req.createdAt}
                                        actions={
                                            <div className="flex items-center gap-2">
                                                {/* 7C: Mutual count badge */}
                                                {(req.mutualCount ?? 0) > 0 && (
                                                    <Badge variant="secondary" className="text-[11px] px-2 py-0.5 gap-1">
                                                        <Users className="w-3 h-3" />
                                                        {req.mutualCount} mutual{req.mutualCount === 1 ? "" : "s"}
                                                    </Badge>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAccept(req.id); }}
                                                    disabled={isProcessing}
                                                    className="px-4 py-1.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                                    aria-label={`Accept request from ${req.requesterFullName || req.requesterUsername || "user"}`}
                                                >
                                                    {isAccepting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Accept"}
                                                </button>
                                                {/* 7B: Rejection reason dropdown */}
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <button
                                                            type="button"
                                                            disabled={isProcessing}
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                            className="px-4 py-1.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                                                            aria-label={`Decline request from ${req.requesterFullName || req.requesterUsername || "user"}`}
                                                        >
                                                            {isRejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                                                                <>
                                                                    Decline
                                                                    <ChevronDown className="w-3 h-3" />
                                                                </>
                                                            )}
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-48">
                                                        <DropdownMenuItem onClick={() => handleReject(req.id)}>
                                                            Decline
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleReject(req.id, "not_now")}>
                                                            Not now
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleReject(req.id, "dont_know")}>
                                                            Don&apos;t know this person
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                            className="px-3 py-1.5 rounded-xl text-sm font-medium text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors inline-flex items-center gap-1"
                                                            aria-label={`More actions for ${req.requesterFullName || req.requesterUsername || "user"}`}
                                                        >
                                                            More
                                                            <ChevronDown className="w-3 h-3" />
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-52">
                                                        {actionModel.secondaryMenu.map((action) => {
                                                            if (!action.href) return null;
                                                            return (
                                                                <DropdownMenuItem key={action.key} asChild>
                                                                    <Link href={action.href}>
                                                                        {action.key === "message" ? (
                                                                            <MessageSquare className="w-4 h-4" />
                                                                        ) : (
                                                                            <ExternalLink className="w-4 h-4" />
                                                                        )}
                                                                        {action.label}
                                                                    </Link>
                                                                </DropdownMenuItem>
                                                            );
                                                        })}
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            onClick={() => handleBlock(req.requesterId, req.requesterFullName || req.requesterUsername || "User")}
                                                        >
                                                            <Ban className="w-4 h-4" />
                                                            Block
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        }
                                    />
                                    {/* 7A: Request message preview */}
                                    <RequestMessagePreview message={req.message} />
                                </div>
                            );
                        })}
                    </div>
                    {hasMoreIncoming && (
                        <button
                            type="button"
                            onClick={() => setIncomingLimit((prev) => prev + REQUESTS_BATCH_STEP)}
                            className="w-full mt-3 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                        >
                            Show {Math.min(REQUESTS_BATCH_STEP, incomingRequests.length - visibleIncomingRequests.length)} more incoming requests
                        </button>
                    )}
                </section>
            )}

            {/* ── Sent Requests Section ── */}
            {sentRequests.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        Sent
                    </h2>
                    <div className="space-y-3">
                        {visibleSentRequests.map((req) => {
                            const profile = {
                                id: req.addresseeId,
                                username: req.addresseeUsername,
                                fullName: req.addresseeFullName,
                                avatarUrl: req.addresseeAvatarUrl,
                                headline: req.addresseeHeadline,
                                location: req.addresseeLocation ?? null,
                                connectionStatus: "pending_sent" as const,
                                canConnect: false,
                                skills: req.addresseeSkills ?? [],
                                openTo: req.addresseeOpenTo ?? [],
                                messagePrivacy: req.addresseeMessagePrivacy ?? "connections",
                                canSendMessage: req.addresseeCanSendMessage ?? false,
                                lastActiveAt: req.addresseeLastActiveAt ?? null,
                            };
                            const profileLink = profileHref(profile);
                            const actionModel = resolveRelationshipActionModel({
                                state: "pending_sent",
                                canSendMessage: Boolean(req.addresseeCanSendMessage),
                                profileHref: profileLink,
                                messageHref: `/messages?userId=${req.addresseeId}`,
                                inviteHref: null,
                            });
                            const isProcessing = cancelRequest.isPending && cancelRequest.variables === req.id;
                            // 5B: Pending days calculation
                            const pendingDays = Math.floor((requestRenderNowMs - new Date(req.createdAt).getTime()) / (1000 * 60 * 60 * 24));

                            return (
                                <PersonCard
                                    key={req.id}
                                    profile={profile}
                                    onConnect={async () => {}}
                                    isConnecting={isProcessing}
                                    variant="request"
                                    requestedAt={req.createdAt}
                                    actions={
                                        <div className="flex items-center gap-2">
                                            {/* 5B: Pending duration badge */}
                                            {pendingDays > 0 && (
                                                <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                                                    Pending {pendingDays}d
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCancel(req.id); }}
                                                disabled={isProcessing}
                                                className="px-4 py-1.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800 transition-colors disabled:opacity-50"
                                                aria-label={`Cancel request to ${req.addresseeFullName || req.addresseeUsername || "user"}`}
                                            >
                                                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancel"}
                                            </button>
                                            <Link
                                                href={profileLink}
                                                className="px-4 py-1.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                            >
                                                View profile
                                            </Link>
                                            {actionModel.canSendMessage ? (
                                                <Link
                                                    href={`/messages?userId=${req.addresseeId}`}
                                                    className="px-4 py-1.5 rounded-xl text-sm font-medium text-sky-700 dark:text-sky-300 border border-sky-200 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/20 hover:bg-sky-100 dark:hover:bg-sky-950/40 transition-colors inline-flex items-center gap-1.5"
                                                >
                                                    <MessageSquare className="w-4 h-4" />
                                                    Message
                                                </Link>
                                            ) : null}
                                        </div>
                                    }
                                />
                            );
                        })}
                    </div>
                    {hasMoreSent && (
                        <button
                            type="button"
                            onClick={() => setSentLimit((prev) => prev + REQUESTS_BATCH_STEP)}
                            className="w-full mt-3 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                        >
                            Show {Math.min(REQUESTS_BATCH_STEP, sentRequests.length - visibleSentRequests.length)} more sent requests
                        </button>
                    )}
                </section>
            )}

            {/* ── Project Applications ── */}
            <CollapsibleSection
                title="Project Applications"
                icon={<Briefcase className="w-4 h-4 text-violet-500" />}
                open={appsOpen}
                onToggle={() => setAppsOpen(!appsOpen)}
                panelId={appsPanelId}
            >
                <ProjectApplicationsSection initialUser={initialUser} initialApplications={initialApplications} />
            </CollapsibleSection>

            {/* ── Activity Timeline ── */}
            <CollapsibleSection
                title="Activity"
                icon={<History className="w-4 h-4 text-blue-500" />}
                open={timelineOpen}
                onToggle={() => setTimelineOpen(!timelineOpen)}
                count={historyItems.length}
                panelId={timelinePanelId}
            >
                {historyLoading && historyItems.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-8">
                        <div className="space-y-4 animate-pulse">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex gap-3">
                                    <div className="w-9 h-9 rounded-full bg-zinc-200/60 dark:bg-zinc-800 flex-shrink-0" />
                                    <div className="flex-1 space-y-2 pt-1">
                                        <div className="h-3.5 w-48 bg-zinc-200/60 dark:bg-zinc-800 rounded" />
                                        <div className="h-3 w-64 bg-zinc-200/60 dark:bg-zinc-800 rounded" />
                                        <div className="h-2.5 w-24 bg-zinc-200/60 dark:bg-zinc-800 rounded" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : visibleHistoryItems.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl px-6 py-12 text-center">
                        <History className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No activity yet</p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                            Your connection and application history will appear here
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* 7D: Connection Activity sub-section */}
                        {connectionHistoryItems.length > 0 && (
                            <CollapsibleSection
                                title="Connection Activity"
                                icon={<UserPlus className="w-4 h-4 text-emerald-500" />}
                                open={connectionActivityOpen}
                                onToggle={() => setConnectionActivityOpen(!connectionActivityOpen)}
                                count={connectionHistoryItems.length}
                                panelId="connection-activity-panel"
                            >
                                <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
                                    {groupedConnectionHistory.map((group, groupIdx) => (
                                        <div key={group.label}>
                                            <div className={cn(
                                                "sticky top-0 z-10 px-5 py-2.5 bg-zinc-50/90 dark:bg-zinc-900/90 backdrop-blur-sm",
                                                groupIdx === 0 ? "rounded-t-2xl" : "border-t border-zinc-200/60 dark:border-white/5",
                                            )}>
                                                <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                                                    {group.label}
                                                </span>
                                            </div>
                                            <div className="px-5 py-4">
                                                {group.items.map((item, itemIdx) => (
                                                    <TimelineItem
                                                        key={`${item.source}-${item.id}-${item.status}-${item.eventAt}`}
                                                        item={item}
                                                        isLast={itemIdx === group.items.length - 1}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* 7D: Application Activity sub-section */}
                        {applicationHistoryItems.length > 0 && (
                            <CollapsibleSection
                                title="Application Activity"
                                icon={<Briefcase className="w-4 h-4 text-violet-500" />}
                                open={applicationActivityOpen}
                                onToggle={() => setApplicationActivityOpen(!applicationActivityOpen)}
                                count={applicationHistoryItems.length}
                                panelId="application-activity-panel"
                            >
                                <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
                                    {groupedApplicationHistory.map((group, groupIdx) => (
                                        <div key={group.label}>
                                            <div className={cn(
                                                "sticky top-0 z-10 px-5 py-2.5 bg-zinc-50/90 dark:bg-zinc-900/90 backdrop-blur-sm",
                                                groupIdx === 0 ? "rounded-t-2xl" : "border-t border-zinc-200/60 dark:border-white/5",
                                            )}>
                                                <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                                                    {group.label}
                                                </span>
                                            </div>
                                            <div className="px-5 py-4">
                                                {group.items.map((item, itemIdx) => (
                                                    <TimelineItem
                                                        key={`${item.source}-${item.id}-${item.status}-${item.eventAt}`}
                                                        item={item}
                                                        isLast={itemIdx === group.items.length - 1}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* Load more */}
                        {(hasMoreHistory || hasMoreHistoryLocal) && (
                            <div className="px-5 py-3">
                                <button
                                    type="button"
                                    disabled={isFetchingMoreHistory}
                                    onClick={() => {
                                        if (hasMoreHistoryLocal) {
                                            setHistoryLimit((prev) => prev + HISTORY_BATCH_STEP);
                                        } else if (hasMoreHistory) {
                                            setHistoryLimit((prev) => prev + HISTORY_BATCH_STEP);
                                            fetchMoreHistory();
                                        }
                                    }}
                                    className="w-full rounded-xl px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                >
                                    {isFetchingMoreHistory ? "Loading..." : "Load more activity"}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </CollapsibleSection>

            <ConfirmDialog
                open={!!bulkAction}
                onOpenChange={(open) => { if (!open) setBulkAction(null); }}
                title={bulkAction?.type === "accept" ? "Accept All Requests" : "Reject All Requests"}
                description={bulkAction?.type === "accept"
                    ? `Accept all ${incomingRequests.length} incoming requests?`
                    : `Reject all ${incomingRequests.length} incoming requests? This cannot be undone in bulk.`}
                confirmLabel={bulkAction?.type === "accept" ? "Accept All" : "Reject All"}
                variant={bulkAction?.type === "reject" ? "destructive" : "default"}
                onConfirm={() => bulkAction?.type === "accept" ? confirmAcceptAll() : confirmRejectAll()}
            />
        </div>
    );
}
