"use client";

import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus } from "lucide-react";
import { profileHref } from "@/lib/routing/identifiers";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import DashboardCard from "./DashboardCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buildProjectPersonReference } from "@/lib/projects/settings-policies";

/* ── Typed project shape consumed by TeamCard ────────────────── */

interface TeamCardOwner {
    id: string;
    fullName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
    displayName?: string;
    isMasked?: boolean;
    canOpenProfile?: boolean;
}

interface TeamCardProject {
    id: string;
    owner?: TeamCardOwner | null;
    importSource?: {
        metadata?: {
            leadFocus?: string | null;
        } | null;
    } | null;
}

interface TeamMember {
    id: string;
    fullName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
    projectRoleTitle?: string | null;
    membershipRole?: string | null;
    joinedAt?: string | null;
}

interface TeamCardProps {
    project: TeamCardProject;
    members: TeamMember[];
    isCreator: boolean;
    onInvite: () => void;
    hasNextMembers?: boolean;
    fetchNextMembers?: () => void;
    loadingMembers?: boolean;
}

/* ── Avatar entry used for rendering ─────────────────────────── */

type AvatarEntry = {
    id: string;
    src?: string | null;
    fallback: string;
    name: string;
    role: string;
    username?: string | null;
    sortDateMs?: number;
};

/* ── Helpers ─────────────────────────────────────────────────── */

const toInitials = (label: string) =>
    (label || "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";

const shortenRoleLabel = (label: string) => {
    return (label || "").trim() || "Team Member";
};

/* ── Component ───────────────────────────────────────────────── */

const TeamCard = memo(function TeamCard({
    project,
    members,
    isCreator,
    onInvite,
    hasNextMembers,
    fetchNextMembers,
    loadingMembers,
}: TeamCardProps) {
    const router = useRouter();
    const prefetch = useRouteWarmPrefetch();
    const [failedImageIds, setFailedImageIds] = useState<Record<string, boolean>>({});

    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const navigateToProfile = useCallback((avatar: AvatarEntry) => {
        if (!avatar.username) return;
        router.push(profileHref({ username: avatar.username, id: avatar.id }));
    }, [router]);

    const handleMouseEnter = useCallback((avatar: AvatarEntry) => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
        }
        if (!avatar.username) return;
        hoverTimerRef.current = setTimeout(() => {
            prefetch(profileHref({ username: avatar.username!, id: avatar.id }));
        }, 80);
    }, [prefetch]);

    const handleFocus = useCallback((avatar: AvatarEntry) => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
        }
        if (!avatar.username) return;
        hoverTimerRef.current = setTimeout(() => {
            prefetch(profileHref({ username: avatar.username!, id: avatar.id }));
        }, 80);
    }, [prefetch]);

    const handleMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    }, []);

    const handleImageError = useCallback((id: string) => {
        setFailedImageIds((prev) => ({ ...prev, [id]: true }));
    }, []);

    useEffect(() => {
        return () => {
            if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
            }
        };
    }, []);

    const rawLeadFocus = project?.importSource?.metadata?.leadFocus;
    const leadFocus = typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";

    const avatars = useMemo<AvatarEntry[]>(() => {
        const ownerEntry: AvatarEntry[] = project?.owner?.id
            ? (() => {
                const reference = buildProjectPersonReference({
                    person: project.owner,
                    membershipRole: "owner",
                    isActiveMember: true,
                });
                return [{
                    id: project.owner.id,
                    src: reference.avatarUrl,
                    fallback: toInitials(reference.displayName),
                    name: reference.displayName,
                    role: shortenRoleLabel(leadFocus ? `${reference.roleLabel} / ${leadFocus}` : reference.roleLabel),
                    username: project.owner.username,
                }];
            })()
            : [];

        const collaborators: AvatarEntry[] = (members || [])
            .filter((m) => m?.id && m.id !== project?.owner?.id)
            .map((member) => {
                const reference = buildProjectPersonReference({
                    person: member,
                    membershipRole: member.membershipRole,
                    isActiveMember: true,
                });
                const roleLabel = member.projectRoleTitle
                    ? `${member.projectRoleTitle} · ${reference.roleLabel}`
                    : reference.roleLabel;
                const joinedAtMs = member.joinedAt ? new Date(member.joinedAt).getTime() : undefined;

                return {
                    id: member.id,
                    src: reference.avatarUrl,
                    fallback: toInitials(reference.displayName),
                    name: reference.displayName,
                    role: shortenRoleLabel(roleLabel),
                    username: member.username,
                    sortDateMs: Number.isFinite(joinedAtMs) ? joinedAtMs : undefined,
                };
            })
            .sort((a, b) => {
                const aMs = a.sortDateMs;
                const bMs = b.sortDateMs;
                if (typeof aMs === "number" && typeof bMs === "number") return bMs - aMs;
                if (typeof aMs === "number") return -1;
                if (typeof bMs === "number") return 1;
                return a.name.localeCompare(b.name);
            });

        return [...ownerEntry, ...collaborators];
    }, [leadFocus, members, project]);

    const visibleAvatars = useMemo(() => avatars.slice(0, 5), [avatars]);
    const showMoreCount = avatars.length - 5;
    const hasOverflow = showMoreCount > 0 || hasNextMembers;

    return (
        <DashboardCard
            title="The Team"
            icon={Users}
            compact
            className="flex flex-col h-fit"
            action={isCreator && (
                <button
                    onClick={onInvite}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-primary rounded transition-all opacity-65 hover:opacity-100 hover:bg-primary/10"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Invite
                </button>
            )}
        >
            <div className="py-1 flex flex-col gap-1">
                {loadingMembers && avatars.length === 0 ? (
                    <div className="max-h-[260px] overflow-y-auto pr-1 flex flex-col gap-1">
                        <div className="space-y-1">
                            {Array.from({ length: 5 }).map((_, idx) => (
                                <div key={idx} className="flex items-center gap-2.5 py-1.5 px-2">
                                    <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800/60 animate-pulse shrink-0" />
                                    <div className="flex-grow min-w-0 flex items-center gap-2">
                                        <div className="h-3.5 w-20 bg-zinc-200 dark:bg-zinc-800/60 rounded animate-pulse shrink-0" />
                                        <span className="text-zinc-300 dark:text-zinc-800/40 shrink-0 select-none">·</span>
                                        <div className="h-3 w-28 bg-zinc-200 dark:bg-zinc-800/60 rounded animate-pulse truncate" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : avatars.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-4">
                        <Users className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">No team members yet</p>
                    </div>
                ) : (
                    <div className="max-h-[260px] overflow-y-auto pr-1 flex flex-col gap-1">
                        <div className="space-y-1">
                            {visibleAvatars.map((avatar) => (
                                <button
                                    key={avatar.id}
                                    type="button"
                                    onClick={() => navigateToProfile(avatar)}
                                    onMouseEnter={() => handleMouseEnter(avatar)}
                                    onMouseLeave={handleMouseLeave}
                                    onFocus={() => handleFocus(avatar)}
                                    onBlur={handleMouseLeave}
                                    className="w-full text-left flex items-center gap-2.5 py-1.5 px-2 rounded-xl cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:bg-zinc-50 dark:focus-visible:bg-zinc-800/40 transition-all duration-150 group"
                                    aria-label={`${avatar.name} profile`}
                                >
                                    <Avatar className="size-9 border border-zinc-200 dark:border-zinc-800 shrink-0">
                                        <AvatarImage
                                            src={failedImageIds[avatar.id] ? undefined : (avatar.src || undefined)}
                                            onError={() => handleImageError(avatar.id)}
                                        />
                                        <AvatarFallback className="text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                            {avatar.fallback}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-grow min-w-0 flex items-center gap-2 text-sm">
                                        <span className="font-semibold text-zinc-850 dark:text-zinc-200 group-hover:text-primary transition-colors shrink-0">
                                            {avatar.name}
                                        </span>
                                        <span className="text-zinc-400 dark:text-zinc-500 shrink-0 select-none">·</span>
                                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate">
                                            {avatar.role}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {hasOverflow && (
                    <div className="mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/60 flex justify-center">
                        <button
                            onClick={onInvite}
                            className="px-2.5 py-1 text-[11px] font-bold text-primary hover:underline transition-colors"
                        >
                            {showMoreCount > 0 ? `+ ${showMoreCount} more ${showMoreCount === 1 ? "member" : "members"}` : "View more members"}
                        </button>
                    </div>
                )}
            </div>
        </DashboardCard>
    );
});

export default TeamCard;
