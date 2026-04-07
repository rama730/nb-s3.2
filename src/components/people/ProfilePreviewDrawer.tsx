"use client";

import React from "react";
import Link from "next/link";
import NextImage from "next/image";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    MapPin, Briefcase, Users, Clock, ExternalLink, Circle,
    UserPlus, Check, MessageSquare, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { profileHref } from "@/lib/routing/identifiers";
import { formatLastActive } from "@/lib/ui/date-formatting";
import type { SuggestedProfile } from "@/app/actions/connections";
import { toast } from "sonner";
import { resolveRelationshipActionModel } from "@/components/people/person-card-model";
import { getAvatarGradient } from "@/lib/ui/avatar";
import { AVAILABILITY_CONFIG, EXPERIENCE_LABELS } from "@/lib/ui/status-config";

// ── Types ────────────────────────────────────────────────────────────

interface ProfilePreviewDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    profile: PreviewProfile | null;
    onConnect?: (userId: string) => Promise<void>;
    isConnecting?: boolean;
    viewerSkills?: string[];
}

type PreviewProfile = SuggestedProfile & {
    bio?: string | null;
};

// ── Component ────────────────────────────────────────────────────────

export default function ProfilePreviewDrawer({
    open,
    onOpenChange,
    profile,
    onConnect,
    isConnecting,
    viewerSkills,
}: ProfilePreviewDrawerProps) {
    if (!profile) return null;

    const displayName = profile.fullName || profile.username || "User";
    const displayUsername = profile.username ? `@${profile.username}` : null;
    const initial = (profile.fullName || profile.username || "U")[0]?.toUpperCase() ?? "U";
    const href = profileHref(profile);
    const viewerSkillSet = viewerSkills ? new Set(viewerSkills.map(s => s.toLowerCase())) : undefined;

    const availability = profile.availabilityStatus && AVAILABILITY_CONFIG[profile.availabilityStatus]
        ? AVAILABILITY_CONFIG[profile.availabilityStatus]
        : null;
    const experience = profile.experienceLevel && EXPERIENCE_LABELS[profile.experienceLevel]
        ? EXPERIENCE_LABELS[profile.experienceLevel]
        : null;

    // Active recency
    const activeLabel = formatLastActive(profile.lastActiveAt);

    const isConnected = profile.connectionStatus === "connected";
    const isPending = profile.connectionStatus === "pending_sent";
    const isBlocked = profile.connectionStatus === "blocked";
    const actionModel = resolveRelationshipActionModel({
        state: profile.connectionStatus,
        canSendMessage: Boolean(profile.canSendMessage),
        profileHref: href,
        messageHref: `/messages?userId=${profile.id}`,
        inviteHref: isConnected ? `${href}#profile-collaboration` : null,
    });

    const handleConnectClick = async () => {
        if (!onConnect) return;
        try {
            await onConnect(profile.id);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to send connection request");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    "fixed inset-y-0 right-0 m-0 h-full w-full max-w-md rounded-none border-l",
                    "bg-white dark:bg-zinc-950 p-0 duration-300",
                    "data-[state=open]:animate-in data-[state=closed]:animate-out",
                    "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
                )}
                showCloseButton
            >
                <div className="flex flex-col h-full overflow-y-auto">
                    {/* Header */}
                    <div className="px-6 pt-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-start gap-4">
                            {/* Avatar */}
                            {profile.avatarUrl ? (
                                <NextImage
                                    src={profile.avatarUrl}
                                    alt={displayName}
                                    width={64}
                                    height={64}
                                    className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                                />
                            ) : (
                                <div className={cn(
                                    "w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0",
                                    "bg-gradient-to-br text-white font-semibold text-xl",
                                    getAvatarGradient(displayName),
                                )}>
                                    {initial}
                                </div>
                            )}

                            <div className="min-w-0 flex-1">
                                <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                    {displayName}
                                </DialogTitle>
                                {displayUsername && (
                                    <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
                                        {displayUsername}
                                    </DialogDescription>
                                )}

                                {/* Status line */}
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {availability && (
                                        <span className={cn("flex items-center gap-1 text-xs", availability.color)}>
                                            <Circle aria-hidden="true" className="w-2 h-2 fill-current" />
                                            {availability.label}
                                        </span>
                                    )}
                                    {experience && (
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {availability ? "·" : ""} {experience}
                                        </span>
                                    )}
                                    {activeLabel && (
                                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                            · {activeLabel}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 px-6 py-4 space-y-5">
                        {/* Headline */}
                        {profile.headline && (
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                {profile.headline}
                            </p>
                        )}

                        {/* Bio */}
                        {profile.bio && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                                {profile.bio}
                            </p>
                        )}

                        {/* Location */}
                        {profile.location && (
                            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{profile.location}</span>
                            </div>
                        )}

                        {/* Mutual connections */}
                        {(profile.mutualConnections ?? 0) > 0 && (
                            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                                <Users className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{profile.mutualConnections} mutual connection{profile.mutualConnections !== 1 ? "s" : ""}</span>
                            </div>
                        )}

                        {/* Recommendation reason */}
                        {profile.recommendationReason
                            && profile.recommendationReason !== "Suggested for your network"
                            && profile.recommendationReason !== "Trending in your network" && (
                            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300">
                                {profile.recommendationReason}
                            </div>
                        )}

                        {/* Skills */}
                        {profile.skills && profile.skills.length > 0 && (
                            <div>
                                <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                                    Skills
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {profile.skills.slice(0, 12).map((skill) => {
                                        const isMatch = viewerSkillSet?.has(skill.toLowerCase());
                                        return (
                                            <Badge
                                                key={skill}
                                                variant={isMatch ? "default" : "outline"}
                                                className="text-xs"
                                            >
                                                {skill}
                                            </Badge>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Interests */}
                        {profile.interests && profile.interests.length > 0 && (
                            <div>
                                <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                                    Interests
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {profile.interests.slice(0, 8).map((interest) => (
                                        <Badge key={interest} variant="outline" className="text-xs">
                                            {interest}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Projects */}
                        {profile.projects && profile.projects.length > 0 && (
                            <div>
                                <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                                    Projects
                                </h4>
                                <div className="space-y-2">
                                    {profile.projects.filter(p => p.status !== "archived").slice(0, 5).map((project) => (
                                        <div
                                            key={project.id}
                                            className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                                        >
                                            <Briefcase className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                                            <span className="truncate">{project.title}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
                        {!isConnected && !isPending && !isBlocked && onConnect && (
                            <Button
                                onClick={() => {
                                    void handleConnectClick();
                                }}
                                disabled={isConnecting}
                                size="sm"
                                className="gap-1.5"
                            >
                                <UserPlus className="w-3.5 h-3.5" />
                                Connect
                            </Button>
                        )}

                        {isPending && (
                            <Button disabled size="sm" variant="outline" className="gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                Pending
                            </Button>
                        )}

                        {isConnected && (
                            <Button size="sm" variant="outline" className="gap-1.5" disabled>
                                <Check className="w-3.5 h-3.5" />
                                Connected
                            </Button>
                        )}

                        {isBlocked && (
                            <Button size="sm" variant="outline" className="gap-1.5" disabled>
                                <Ban className="w-3.5 h-3.5" />
                                Blocked
                            </Button>
                        )}

                        {actionModel.canSendMessage && !isBlocked && (
                            <Button asChild size="sm" variant="outline" className="gap-1.5">
                                <Link href={`/messages?userId=${profile.id}`}>
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    Message
                                </Link>
                            </Button>
                        )}

                        {isConnected && !isBlocked && (
                            <Button asChild size="sm" variant="outline" className="gap-1.5">
                                <Link href={`${href}#profile-collaboration`}>
                                    <Briefcase className="w-3.5 h-3.5" />
                                    Invite
                                </Link>
                            </Button>
                        )}

                        <Button asChild size="sm" variant="outline" className="gap-1.5 ml-auto">
                            <Link href={href}>
                                <ExternalLink className="w-3.5 h-3.5" />
                                View Profile
                            </Link>
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
