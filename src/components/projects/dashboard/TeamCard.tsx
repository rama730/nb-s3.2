"use client";

import { memo, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus } from "lucide-react";
import { profileHref } from "@/lib/routing/identifiers";
import DashboardCard from "./DashboardCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarGroup, AvatarGroupTooltip } from "@/components/animate-ui/components/animate/avatar-group";

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
    const clean = (label || "").trim() || "Team Member";
    return clean.length > 28 ? `${clean.slice(0, 25)}...` : clean;
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
    const [isOverflowTooltipOpen, setIsOverflowTooltipOpen] = useState(false);

    const navigateToProfile = useCallback((avatar: AvatarEntry) => {
        if (!avatar.username) return;
        router.push(profileHref({ username: avatar.username, id: avatar.id }));
    }, [router]);

    const rawLeadFocus = project?.importSource?.metadata?.leadFocus;
    const leadFocus = typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";
    const ownerRoleLabel = leadFocus ? `LEAD / ${leadFocus}` : "LEAD";
    const ownerName = project?.owner?.displayName || project?.owner?.fullName || project?.owner?.username || "Creator";

    const avatars = useMemo<AvatarEntry[]>(() => {
        const ownerEntry: AvatarEntry[] = project?.owner?.id
            ? [{
                id: project.owner.id,
                src: project.owner.avatarUrl,
                fallback: toInitials(ownerName),
                name: ownerName,
                role: shortenRoleLabel(ownerRoleLabel),
                username: project.owner.username,
            }]
            : [];

        const collaborators: AvatarEntry[] = (members || [])
            .filter((m) => m?.id && m.id !== project?.owner?.id)
            .map((member) => {
                const roleLabel = member.projectRoleTitle || member.membershipRole || "Team Member";
                const fullName = member.fullName || member.username || "Member";
                const joinedAtMs = member.joinedAt ? new Date(member.joinedAt).getTime() : undefined;

                return {
                    id: member.id,
                    src: member.avatarUrl,
                    fallback: toInitials(fullName),
                    name: fullName,
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
    }, [members, ownerName, ownerRoleLabel, project]);

    const MAX_VISIBLE = 6;
    const visibleAvatars = avatars.slice(0, MAX_VISIBLE);
    const hiddenAvatars = avatars.slice(MAX_VISIBLE);
    const hiddenCount = hiddenAvatars.length;
    const hiddenPreview = hiddenAvatars.slice(0, 5);
    const hiddenRemaining = Math.max(0, hiddenCount - hiddenPreview.length);

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
            <div className="py-2 overflow-visible">
                {loadingMembers && avatars.length === 0 ? (
                    <div className="flex justify-center -space-x-3">
                        {Array.from({ length: 4 }).map((_, idx) => (
                            <div
                                key={idx}
                                className="size-12 rounded-full border-3 border-background bg-zinc-200 dark:bg-zinc-800 animate-pulse"
                            />
                        ))}
                    </div>
                ) : avatars.length === 0 ? (
                    <div className="flex flex-col items-center gap-2">
                        <Avatar className="size-12 border-3 border-background">
                            <AvatarFallback className="text-xs font-semibold">--</AvatarFallback>
                        </Avatar>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">No team members yet</p>
                    </div>
                ) : (
                    <AvatarGroup className="w-full justify-center">
                        {visibleAvatars.map((avatar) => (
                            <div
                                key={avatar.id}
                                onClick={() => navigateToProfile(avatar)}
                                className="group relative inline-flex size-12 shrink-0 cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        navigateToProfile(avatar);
                                    }
                                }}
                                aria-label={`${avatar.name} profile`}
                            >
                                <Avatar
                                    className="absolute inset-0 size-12 border-3 border-background transition-transform duration-200 ease-out group-hover:-translate-y-1.5 group-hover:z-10"
                                >
                                    <AvatarImage src={avatar.src || undefined} />
                                    <AvatarFallback>{avatar.fallback}</AvatarFallback>
                                </Avatar>
                                <AvatarGroupTooltip>
                                    <div className="flex flex-col items-center gap-0.5">
                                        <span className="font-semibold text-white">{avatar.name}</span>
                                        <span className="text-[11px] text-white/70">{avatar.role}</span>
                                    </div>
                                </AvatarGroupTooltip>
                            </div>
                        ))}

                        {hiddenCount > 0 && (
                            <Avatar
                                tabIndex={0}
                                role="button"
                                aria-haspopup="true"
                                aria-expanded={isOverflowTooltipOpen}
                                aria-label={`Show hidden team members (${hiddenCount})`}
                                onFocus={() => setIsOverflowTooltipOpen(true)}
                                onBlur={() => setIsOverflowTooltipOpen(false)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setIsOverflowTooltipOpen((o) => !o);
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        setIsOverflowTooltipOpen(false);
                                    }
                                }}
                                className="size-12 border-3 border-background bg-zinc-100 dark:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                <AvatarFallback className="text-xs font-semibold">+{hiddenCount}</AvatarFallback>
                                <AvatarGroupTooltip open={isOverflowTooltipOpen} onOpenChange={setIsOverflowTooltipOpen}>
                                    <div className="w-52 max-h-44 overflow-y-auto text-left leading-tight pr-1 text-white" role="status" aria-live="polite">
                                        <p className="font-medium">+{hiddenCount} more team member{hiddenCount === 1 ? "" : "s"}</p>
                                        <ul className="mt-1.5 space-y-1 text-[11px]">
                                            {hiddenPreview.map((a) => (
                                                <li key={a.id} className="truncate">
                                                    <span className="font-medium text-white">{a.name}</span>
                                                    <span className="text-white/60"> · {a.role}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        {hiddenRemaining > 0 && (
                                            <p className="mt-1 text-[11px] text-white/80">and {hiddenRemaining} more</p>
                                        )}
                                    </div>
                                </AvatarGroupTooltip>
                            </Avatar>
                        )}
                    </AvatarGroup>
                )}

                {hasNextMembers && fetchNextMembers && (
                    <div className="mt-3 flex justify-center">
                        <button
                            onClick={fetchNextMembers}
                            disabled={loadingMembers}
                            className="px-2 py-1 text-[10px] font-semibold text-primary border border-primary/15 rounded-md hover:bg-primary/10 transition-colors disabled:opacity-60"
                        >
                            {loadingMembers ? "Loading..." : "Load more"}
                        </button>
                    </div>
                )}
            </div>
        </DashboardCard>
    );
});

export default TeamCard;
