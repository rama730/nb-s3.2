"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, MapPin, Loader2, Check, ChevronDown, Clock, MessageSquare, UserPlus, X, Users, Briefcase, Circle, ExternalLink, Ban } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatLastActive } from "@/lib/ui/date-formatting";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buildPrivacyPresentation } from "@/lib/privacy/presentation";
import { profileHref } from "@/lib/routing/identifiers";
import { buildProfileStatusSummary } from "@/lib/ui/status-config";
import type { SuggestedProfile } from "@/app/actions/connections";
import { buildDiscoverMatchBadges, resolveRelationshipActionModel, type RelationshipMenuAction } from "@/components/people/person-card-model";

export type PersonCardVariant = "discover" | "featured" | "network" | "request";

export interface PersonCardProps {
    profile: SuggestedProfile;
    onConnect: (userId: string) => Promise<void>;
    onDisconnect?: (userId: string, connectionId?: string) => Promise<void>;
    onDismiss?: (userId: string) => Promise<void>;
    isConnecting?: boolean;
    variant?: PersonCardVariant;
    priority?: boolean;
    actions?: React.ReactNode;
    connectedAt?: Date | string;
    requestedAt?: Date | string;
    /** Viewer's project IDs for shared-project detection */
    viewerProjectIds?: Set<string>;
    /** Viewer's skills for skill-matching highlights */
    viewerSkills?: string[];
    /** Viewer's location for location-based badges */
    viewerLocation?: string | null;
}

// ── Avatar ──────────────────────────────────────────────────────────

function Avatar({
    profile,
    size,
    priority,
}: {
    profile: SuggestedProfile;
    size: number;
    priority: boolean;
}) {
    const textSize = size <= 40 ? "text-sm" : "text-base";

    return (
        <UserAvatar
            identity={profile}
            size={size}
            priority={priority}
            className="flex-shrink-0"
            fallbackClassName={cn("font-semibold text-white", textSize)}
        />
    );
}

// ── Connect button ──────────────────────────────────────────────────

function ConnectButton({
    localStatus,
    isConnecting,
    onClick,
    compact,
}: {
    localStatus: SuggestedProfile["connectionStatus"];
    isConnecting?: boolean;
    onClick: (e: React.MouseEvent) => void;
    compact?: boolean;
}) {
    const disabled = isConnecting || localStatus === "connected" || localStatus === "pending_sent";

    if (localStatus === "connected") {
        return (
            <span className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400",
                compact ? "px-2.5 py-1" : "px-3 py-1.5",
            )}>
                <Check className="w-3.5 h-3.5" />
                Connected
            </span>
        );
    }

    if (localStatus === "pending_sent") {
        return (
            <span className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500",
                compact ? "px-2.5 py-1" : "px-3 py-1.5",
            )}>
                <Clock className="w-3.5 h-3.5" />
                Pending
            </span>
        );
    }

    if (localStatus === "blocked") {
        return (
            <span className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400",
                compact ? "px-2.5 py-1" : "px-3 py-1.5",
            )}>
                <Ban className="w-3.5 h-3.5" />
                Blocked
            </span>
        );
    }

    const label = localStatus === "pending_received" ? "Accept" : "Connect";

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-colors",
                "border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300",
                "hover:border-primary hover:text-primary dark:hover:border-primary dark:hover:text-primary",
                "disabled:opacity-60",
                compact ? "px-2.5 py-1" : "px-3 py-1.5",
            )}
        >
            {isConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
                <UserPlus className="w-3.5 h-3.5" />
            )}
            {label}
        </button>
    );
}

// ── Status line ──────────────────────────────────────────────────────

function StatusLine({ profile }: { profile: SuggestedProfile }) {
    const statusSummary = buildProfileStatusSummary({
        availabilityStatus: profile.availabilityStatus,
        experienceLevel: profile.experienceLevel,
        activeLabel: formatLastActive(profile.lastActiveAt),
    });

    if (statusSummary.parts.length === 0) return null;

    return (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
            {statusSummary.availabilityColor && <Circle aria-hidden="true" className={cn("w-2 h-2 fill-current", statusSummary.availabilityColor)} />}
            <span>{statusSummary.parts.join(" · ")}</span>
        </div>
    );
}

const MATCH_BADGE_TONES: Record<ReturnType<typeof buildDiscoverMatchBadges>[number]["tone"], string> = {
    sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200",
    violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-200",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200",
    amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200",
};

function RelationshipMenuItems({
    actions,
    onDisconnect,
    isProcessing,
}: {
    actions: RelationshipMenuAction[];
    onDisconnect?: (e: React.MouseEvent) => Promise<void>;
    isProcessing?: boolean;
}) {
    return (
        <>
            {actions.map((action, index) => {
                if (action.key === "disconnect") {
                    if (!onDisconnect) return null;
                    return (
                        <React.Fragment key={action.key}>
                            {index > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuItem onClick={onDisconnect} disabled={isProcessing} variant="destructive">
                                <X className="w-4 h-4" />
                                {action.label}
                            </DropdownMenuItem>
                        </React.Fragment>
                    );
                }

                const icon = action.key === "message"
                    ? <MessageSquare className="w-4 h-4" />
                    : action.key === "invite_to_project"
                        ? <Briefcase className="w-4 h-4" />
                        : <ExternalLink className="w-4 h-4" />;

                if (!action.href) return null;
                return (
                    <DropdownMenuItem key={action.key} asChild>
                        <Link href={action.href}>
                            {icon}
                            {action.label}
                        </Link>
                    </DropdownMenuItem>
                );
            })}
        </>
    );
}

function MatchBadges({
    profile,
    viewerSkills,
    viewerLocation,
}: {
    profile: SuggestedProfile;
    viewerSkills?: string[];
    viewerLocation?: string | null;
}) {
    const badges = buildDiscoverMatchBadges({
        profileSkills: profile.skills ?? [],
        viewerSkills: viewerSkills ?? [],
        profileLocation: profile.location,
        viewerLocation,
        openTo: profile.openTo ?? [],
        mutualConnections: profile.mutualConnections ?? 0,
    });

    if (badges.length === 0) return null;

    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.slice(0, 4).map((badge) => (
                <span
                    key={badge.key}
                    className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        MATCH_BADGE_TONES[badge.tone],
                    )}
                >
                    {badge.label}
                </span>
            ))}
        </div>
    );
}

// ── Context line (mutual, location, projects) ───────────────────────

function ContextLine({
    profile,
    viewerProjectIds,
}: {
    profile: SuggestedProfile;
    viewerProjectIds?: Set<string>;
}) {
    const parts: React.ReactNode[] = [];

    // Shared project (idea 5)
    if (profile.projects && profile.projects.length > 0 && viewerProjectIds && viewerProjectIds.size > 0) {
        const shared = profile.projects.find(p => viewerProjectIds.has(p.id));
        if (shared) {
            parts.push(
                <span key="shared" className="inline-flex items-center gap-1 text-primary font-medium truncate">
                    <Briefcase className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">Also on {shared.title}</span>
                </span>
            );
        }
    }

    if ((profile.mutualConnections ?? 0) > 0) {
        parts.push(
            <span key="mutual" className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {profile.mutualConnections} mutual
            </span>
        );
    }

    if (profile.location) {
        parts.push(
            <span key="loc" className="inline-flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{profile.location}</span>
            </span>
        );
    }

    // Non-shared projects
    if (profile.projects && profile.projects.length > 0) {
        const activeProjects = profile.projects.filter(p => p.status !== "archived");
        const nonShared = viewerProjectIds
            ? activeProjects.filter(p => !viewerProjectIds.has(p.id))
            : activeProjects;
        if (nonShared.length > 0) {
            const label = nonShared.length === 1
                ? nonShared[0].title
                : `${nonShared.length} projects`;
            parts.push(
                <span key="proj" className="inline-flex items-center gap-1 truncate">
                    <Briefcase className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{label}</span>
                </span>
            );
        }
    }

    if (parts.length === 0) return null;

    return (
        <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
            {parts}
        </div>
    );
}

// ── Main component ──────────────────────────────────────────────────

function PersonCard({
    profile,
    onConnect,
    onDisconnect,
    onDismiss,
    isConnecting,
    variant = "discover",
    priority = false,
    actions,
    connectedAt,
    requestedAt,
    viewerProjectIds,
    viewerSkills,
    viewerLocation,
}: PersonCardProps) {
    const [localStatus, setLocalStatus] = useState(profile.connectionStatus);
    const [isDisconnecting, setIsDisconnecting] = useState(false);

    useEffect(() => {
        setLocalStatus(profile.connectionStatus);
    }, [profile.connectionStatus]);

    const handleConnect = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (localStatus !== "none" && localStatus !== "pending_received") return;
        const prevStatus = localStatus;
        setLocalStatus(localStatus === "pending_received" ? "connected" : "pending_sent");
        try {
            await onConnect(profile.id);
        } catch {
            setLocalStatus(prevStatus);
        }
    };

    const handleDismiss = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onDismiss) return;
        await onDismiss(profile.id);
    };

    const handleDisconnect = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onDisconnect || localStatus !== "connected") return;
        const previousStatus = localStatus;
        setLocalStatus("none");
        setIsDisconnecting(true);
        try {
            await onDisconnect(profile.id, profile.connectionId);
        } catch {
            setLocalStatus(previousStatus);
        } finally {
            setIsDisconnecting(false);
        }
    };

    const isLocked = !!profile.isLockedProfile;
    const privacyLabel = buildPrivacyPresentation(
        isLocked
            ? {
                viewerId: null,
                targetUserId: profile.id,
                isSelf: false,
                isConnected: localStatus === "connected",
                hasPendingIncomingRequest: localStatus === "pending_received",
                hasPendingOutgoingRequest: localStatus === "pending_sent",
                blockedByViewer: false,
                blockedByTarget: false,
                profileVisibility: profile.profileVisibility === "private" ? "private" : profile.profileVisibility === "connections" ? "connections" : "public",
                messagePrivacy: "connections",
                connectionPrivacy: "everyone",
                canViewProfile: false,
                canSendConnectionRequest: profile.canConnect !== false,
                canSendMessage: false,
                shouldHideFromDiscovery: false,
                visibilityReason: profile.profileVisibility === "private" ? "private" : "connections_only",
                connectionState: "none",
                latestConnectionId: null,
            }
            : null,
    ).relationshipBadgeText;

    const displayName = profile.fullName || profile.username || "User";
    const displayUsername = profile.username ? `@${profile.username}` : null;
    const hasHeadline = !!profile.headline && !isLocked;
    const isEmptyProfile = !profile.fullName && !profile.headline && !profile.location;
    const profileLink = profileHref(profile);
    const messageHref = `/messages?userId=${profile.id}`;
    const inviteHref = `${profileLink}#profile-collaboration`;
    const canSendMessage = Boolean(profile.canSendMessage);
    const actionModel = resolveRelationshipActionModel({
        state: localStatus,
        canSendMessage,
        profileHref: profileLink,
        messageHref,
        inviteHref: localStatus === "connected" ? inviteHref : null,
    });

    // Clean recommendation reason for display (idea 1)
    const showReason = !isLocked
        && profile.recommendationReason
        && profile.recommendationReason !== "Suggested for your network"
        && !(profile.mutualConnections && profile.recommendationReason === `${profile.mutualConnections} mutual connections`);

    // ── Network variant ─────────────────────────────────────────────
    if (variant === "network") {
        return (
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700 group">
                <Link href={profileHref(profile)} className="flex-shrink-0">
                    <Avatar profile={profile} size={40} priority={priority} />
                </Link>
                <Link href={profileHref(profile)} className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate group-hover:text-primary transition-colors">
                        {displayName}
                    </h3>
                    {hasHeadline ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{profile.headline}</p>
                    ) : null}
                    {profile.location ? (
                        <p className="text-[11px] text-zinc-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />{profile.location}
                        </p>
                    ) : null}
                    {/* 4A: Skill pills on network cards */}
                    {((profile.skills && profile.skills.length > 0) || (profile.tags && profile.tags.length > 0)) && (
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                            {(profile.skills ?? []).slice(0, 2).map((skill) => (
                                <span key={skill} className="text-[10px] px-1.5 py-0 border border-zinc-300 dark:border-zinc-600 rounded-full text-zinc-500 dark:text-zinc-400">
                                    {skill}
                                </span>
                            ))}
                            {(profile.tags ?? []).slice(0, 2).map((tag) => (
                                <span key={`tag-${tag}`} className="text-[10px] px-1.5 py-0 border border-dashed border-sky-300 dark:border-sky-800 rounded-full text-sky-700 dark:text-sky-300">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </Link>
                <div className="text-right shrink-0">
                    {/* 4G: Connected since — mobile compact + desktop full */}
                    {connectedAt ? (
                        <>
                            <p className="text-xs text-zinc-400 hidden sm:block">
                                Connected {formatDistanceToNow(new Date(connectedAt), { addSuffix: true })}
                            </p>
                            <p className="text-xs text-zinc-400 sm:hidden">
                                {new Date(connectedAt).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
                            </p>
                        </>
                    ) : null}
                    {(profile.mutualConnections ?? 0) > 0 ? (
                        <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center justify-end gap-1">
                            <Users className="w-3 h-3" />
                            {profile.mutualConnections} mutual
                        </p>
                    ) : null}
                </div>
                {actions ? (
                    <div className="flex items-center gap-2 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                        {actions}
                    </div>
                ) : null}
            </div>
        );
    }

    // ── Request variant ─────────────────────────────────────────────
    if (variant === "request") {
        return (
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <Link href={profileHref(profile)} className="flex-shrink-0">
                    <Avatar profile={profile} size={44} priority={priority} />
                </Link>
                <Link href={profileHref(profile)} className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate hover:text-primary transition-colors">
                        {displayName}
                    </h3>
                    {!isLocked && <StatusLine profile={profile} />}
                    {hasHeadline ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{profile.headline}</p>
                    ) : null}
                    {profile.location ? (
                        <p className="text-[11px] text-zinc-400 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" />
                            {profile.location}
                        </p>
                    ) : null}
                    {isLocked && privacyLabel ? (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            <Lock className="w-3 h-3" />{privacyLabel}
                        </div>
                    ) : null}
                </Link>
                {requestedAt ? (
                    <p className="hidden sm:block text-xs text-zinc-400 shrink-0">
                        {formatDistanceToNow(new Date(requestedAt), { addSuffix: true })}
                    </p>
                ) : null}
                {actions ? (
                    <div className="flex items-center gap-2 shrink-0">
                        {actions}
                    </div>
                ) : null}
            </div>
        );
    }

    // ── Discover / Featured variant ─────────────────────────────────
    const breakdownTooltip = (() => {
        if (!profile.scoringBreakdown) return undefined;
        const { overlap, mutual } = profile.scoringBreakdown;
        const parts: string[] = [];
        if (overlap > 0) parts.push(`${overlap} shared skills`);
        if (mutual > 0) parts.push(`${mutual} mutual connections`);
        return parts.length > 0 ? parts.join(", ") : undefined;
    })();

    return (
        <div className={cn(
            "relative flex flex-col h-full rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 overflow-hidden transition-all duration-200 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm group",
            "min-h-[220px]",
        )}>
            {/* Dismiss */}
            {onDismiss && (
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="absolute top-2.5 right-2.5 z-10 p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                    aria-label={`Dismiss ${displayName}`}
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}

            {/* Card body */}
            <Link
                href={profileHref(profile)}
                className="flex-1 flex flex-col p-4 group/link focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
                {/* Top row: avatar + identity */}
                <div className="flex items-start gap-3">
                    <div className={cn(
                        "rounded-full flex-shrink-0",
                        profile.availabilityStatus === "available" && "ring-2 ring-emerald-400/60 animate-pulse",
                    )}>
                        <Avatar profile={profile} size={48} priority={priority} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate group-hover/link:text-primary transition-colors leading-tight">
                            {displayName}
                        </h3>
                        {displayUsername ? (
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{displayUsername}</p>
                        ) : null}
                        {isLocked && privacyLabel ? (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                <Lock className="w-3 h-3" />{privacyLabel}
                            </div>
                        ) : null}
                        {/* Availability + experience (idea 2) */}
                        {!isLocked && <StatusLine profile={profile} />}
                    </div>
                </div>

                {/* Info section */}
                <div className="mt-2.5 flex-1 min-h-0">
                    {hasHeadline ? (
                        <p className="text-[13px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                            {profile.headline}
                        </p>
                    ) : isEmptyProfile ? (
                        <p className="text-[13px] text-zinc-400 dark:text-zinc-500 italic">
                            New member
                        </p>
                    ) : null}

                    {/* Context signals (idea 5: shared projects) */}
                    {!isLocked && <ContextLine profile={profile} viewerProjectIds={viewerProjectIds} />}

                    <MatchBadges
                        profile={profile}
                        viewerSkills={viewerSkills}
                        viewerLocation={viewerLocation}
                    />

                    {/* Skill + interest pills */}
                    {!isLocked && (variant === "discover" || variant === "featured") && (() => {
                        const viewerSkillSet = new Set((viewerSkills ?? []).map(s => s.toLowerCase()));
                        const skills = profile.skills ?? [];
                        const interests = profile.interests ?? [];
                        // 3A: Combined display — if skills exist: 2 skills + 1 interest; else 3 interests
                        const displaySkills = skills.length > 0 ? skills.slice(0, interests.length > 0 ? 2 : 3) : [];
                        const displayInterests = skills.length > 0
                            ? interests.slice(0, 1)
                            : interests.slice(0, 3);
                        if (displaySkills.length === 0 && displayInterests.length === 0) return null;
                        return (
                            <div className="flex items-center gap-1 flex-wrap mt-1.5">
                                {displaySkills.map((skill) => (
                                    <Badge
                                        key={`s-${skill}`}
                                        variant={viewerSkillSet.has(skill.toLowerCase()) ? "default" : "outline"}
                                        className="text-[10px] px-1.5 py-0"
                                    >
                                        {skill}
                                    </Badge>
                                ))}
                                {displayInterests.map((interest) => (
                                    <span
                                        key={`i-${interest}`}
                                        className="text-[10px] px-1.5 py-0 border border-dashed border-teal-400/50 text-teal-600 dark:text-teal-400 rounded-full"
                                    >
                                        {interest}
                                    </span>
                                ))}
                            </div>
                        );
                    })()}

                    {/* Keep the fallback recommendation line only when no structured badges are available */}
                    {showReason && !profile.location && (profile.openTo?.length ?? 0) === 0 && !(profile.mutualConnections ?? 0) && (
                        <p
                            className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5 truncate cursor-help underline decoration-dotted"
                            title={breakdownTooltip || profile.recommendationReason || undefined}
                        >
                            {profile.recommendationReason}
                        </p>
                    )}
                </div>
            </Link>

            {/* Footer */}
            <div className="px-4 pb-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/50">
                {localStatus === "connected" ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="inline-flex w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200"
                                aria-label={`Open actions for ${displayName}`}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <Check className="w-4 h-4" />
                                    Connected
                                </span>
                                <ChevronDown className="w-4 h-4 opacity-70" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            <RelationshipMenuItems
                                actions={actionModel.connectedMenu}
                                onDisconnect={handleDisconnect}
                                isProcessing={isDisconnecting}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : localStatus === "blocked" ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                            <Ban className="w-4 h-4" />
                            Blocked
                        </span>
                        <Link
                            href={profileLink}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-primary hover:text-primary dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-primary dark:hover:text-primary"
                        >
                            View Profile
                        </Link>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        {localStatus === "pending_sent" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                                <Clock className="w-4 h-4" />
                                Requested
                            </span>
                        ) : (
                            <ConnectButton
                                localStatus={localStatus}
                                isConnecting={isConnecting}
                                onClick={handleConnect}
                            />
                        )}
                        <Link
                            href={profileLink}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-primary hover:text-primary dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-primary dark:hover:text-primary"
                        >
                            View Profile
                        </Link>
                        {canSendMessage ? (
                            <Link
                                href={messageHref}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-primary hover:text-primary dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-primary dark:hover:text-primary"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                                Message
                            </Link>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Memoization ─────────────────────────────────────────────────────

const areSameProjects = (
    a: PersonCardProps["profile"]["projects"],
    b: PersonCardProps["profile"]["projects"],
) => {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].title !== b[i].title || a[i].status !== b[i].status) return false;
    }
    return true;
};

const areSameStringArray = (
    a: string[] | undefined | null,
    b: string[] | undefined | null,
) => {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const areSameScoringBreakdown = (
    a: PersonCardProps["profile"]["scoringBreakdown"],
    b: PersonCardProps["profile"]["scoringBreakdown"],
) => {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    return (
        a.overlap === b.overlap &&
        a.mutual === b.mutual &&
        a.recency === b.recency &&
        a.completeness === b.completeness
    );
};

const areCardsEqual = (prev: PersonCardProps, next: PersonCardProps) => (
    prev.profile.id === next.profile.id &&
    prev.profile.connectionStatus === next.profile.connectionStatus &&
    prev.profile.fullName === next.profile.fullName &&
    prev.profile.username === next.profile.username &&
    prev.profile.avatarUrl === next.profile.avatarUrl &&
    prev.profile.headline === next.profile.headline &&
    prev.profile.location === next.profile.location &&
    prev.profile.profileVisibility === next.profile.profileVisibility &&
    prev.profile.isLockedProfile === next.profile.isLockedProfile &&
    prev.profile.mutualConnections === next.profile.mutualConnections &&
    prev.profile.recommendationReason === next.profile.recommendationReason &&
    prev.profile.availabilityStatus === next.profile.availabilityStatus &&
    prev.profile.experienceLevel === next.profile.experienceLevel &&
    prev.profile.connectionId === next.profile.connectionId &&
    prev.profile.messagePrivacy === next.profile.messagePrivacy &&
    prev.profile.canSendMessage === next.profile.canSendMessage &&
    prev.profile.canConnect === next.profile.canConnect &&
    areSameScoringBreakdown(prev.profile.scoringBreakdown, next.profile.scoringBreakdown) &&
    areSameProjects(prev.profile.projects, next.profile.projects) &&
    areSameStringArray(prev.profile.skills, next.profile.skills) &&
    areSameStringArray(prev.profile.tags, next.profile.tags) &&
    areSameStringArray(prev.profile.interests, next.profile.interests) &&
    areSameStringArray(prev.profile.openTo, next.profile.openTo) &&
    prev.profile.lastActiveAt === next.profile.lastActiveAt &&
    prev.isConnecting === next.isConnecting &&
    prev.variant === next.variant &&
    prev.priority === next.priority &&
    prev.onDismiss === next.onDismiss &&
    prev.onConnect === next.onConnect &&
    prev.actions === next.actions &&
    prev.connectedAt === next.connectedAt &&
    prev.requestedAt === next.requestedAt &&
    prev.viewerProjectIds === next.viewerProjectIds &&
    areSameStringArray(prev.viewerSkills, next.viewerSkills) &&
    prev.viewerLocation === next.viewerLocation &&
    prev.onDisconnect === next.onDisconnect
);

export default React.memo(PersonCard, areCardsEqual);
