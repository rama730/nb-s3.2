"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import { Plus, Users } from "lucide-react";
import { profileHref } from "@/lib/routing/identifiers";
import DashboardCard from "./DashboardCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buildProjectPersonReference, formatProjectTeamRole } from "@/lib/projects/settings-policies";

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
    guidance?: {
        guideUserId: string;
        label: string;
        fullName?: string | null;
        username?: string | null;
        avatarUrl?: string | null;
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
    canInvite?: boolean;
    onInvite: () => void;
    loadingMembers?: boolean;
}

type AvatarEntry = {
    id: string;
    src?: string | null;
    fallback: string;
    name: string;
    role: string;
    username?: string | null;
    sortDateMs?: number;
};

const toInitials = (label: string) =>
    (label || "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";

const shortenRoleLabel = (label: string) => (label || "").trim() || "Team Member";

const AvatarRow = memo(function AvatarRow({ avatar }: { avatar: AvatarEntry }) {
    const content = (
        <>
            <Avatar className="size-9 shrink-0 border border-zinc-200 dark:border-zinc-800">
                <AvatarImage src={avatar.src ?? undefined} />
                <AvatarFallback className="bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {avatar.fallback}
                </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-grow items-center gap-2 text-sm">
                <span className="shrink-0 font-semibold text-zinc-850 transition-colors group-hover:text-primary dark:text-zinc-200">
                    {avatar.name}
                </span>
                <span className="shrink-0 text-zinc-400 select-none dark:text-zinc-500">·</span>
                <span className="truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {avatar.role}
                </span>
            </div>
        </>
    );
    const className = "group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-all duration-150 hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none   dark:hover:bg-zinc-800/40 dark:focus-visible:bg-zinc-800/40";

    if (!avatar.username) {
        return <div className={className}>{content}</div>;
    }

    return (
        <Link href={profileHref({ username: avatar.username, id: avatar.id })} className={className} aria-label={`${avatar.name} profile`}>
            {content}
        </Link>
    );
});

const TeamCard = memo(function TeamCard({
    project,
    members,
    isCreator,
    canInvite = isCreator,
    onInvite,
    loadingMembers,
}: TeamCardProps) {
    const rawLeadFocus = project?.importSource?.metadata?.leadFocus;
    const leadFocus = typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";
    const guidance = project?.guidance ?? null;

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
                      role: shortenRoleLabel(formatProjectTeamRole({
                          membershipRole: "owner",
                          leadFocus,
                      })),
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
                const joinedAtMs = member.joinedAt ? new Date(member.joinedAt).getTime() : undefined;

                return {
                    id: member.id,
                    src: reference.avatarUrl,
                    fallback: toInitials(reference.displayName),
                    name: reference.displayName,
                    role: member.id === guidance?.guideUserId
                        ? `${guidance.label} · Co-leader`
                        : shortenRoleLabel(formatProjectTeamRole({
                        membershipRole: member.membershipRole,
                        projectRoleTitle: member.projectRoleTitle,
                    })),
                    username: member.username,
                    sortDateMs: Number.isFinite(joinedAtMs) ? joinedAtMs : undefined,
                };
            })
            .sort((a, b) => {
                if (a.id === guidance?.guideUserId) return -1;
                if (b.id === guidance?.guideUserId) return 1;
                const aMs = a.sortDateMs;
                const bMs = b.sortDateMs;
                if (typeof aMs === "number" && typeof bMs === "number") return bMs - aMs;
                if (typeof aMs === "number") return -1;
                if (typeof bMs === "number") return 1;
                return a.name.localeCompare(b.name);
            });

        const guidanceEntry = guidance && !collaborators.some((member) => member.id === guidance.guideUserId)
            ? (() => {
                const reference = buildProjectPersonReference({
                    person: {
                        id: guidance.guideUserId,
                        fullName: guidance.fullName,
                        username: guidance.username,
                        avatarUrl: guidance.avatarUrl,
                    },
                    membershipRole: "admin",
                    isActiveMember: true,
                });
                return [{
                    id: guidance.guideUserId,
                    src: reference.avatarUrl,
                    fallback: toInitials(reference.displayName),
                    name: reference.displayName,
                    role: `${guidance.label} · Co-leader`,
                    username: guidance.username,
                }];
            })()
            : [];

        return [...ownerEntry, ...guidanceEntry, ...collaborators];
    }, [guidance, leadFocus, members, project?.owner?.id, project?.owner?.username, project?.owner?.displayName, project?.owner?.avatarUrl]);

    const showMoreCount = avatars.length - 5;

    return (
        <DashboardCard
            title={guidance ? "Project Leadership" : "The Team"}
            icon={Users}
            compact
            className="flex h-fit flex-col"
            action={canInvite ? (
                <button
                    type="button"
                    onClick={onInvite}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-primary opacity-65 transition-all hover:bg-primary/10 hover:opacity-100"
                >
                    <Plus className="h-3.5 w-3.5" />
                    Invite
                </button>
            ) : null}
        >
            <div className="flex flex-col gap-1 py-1">
                {loadingMembers && avatars.length === 0 ? (
                    <div className="max-h-[260px] overflow-y-auto pr-1">
                        <div className="space-y-1">
                            {Array.from({ length: 5 }).map((_, idx) => (
                                <div key={idx} className="flex items-center gap-2.5 px-2 py-1.5">
                                    <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800/60" />
                                    <div className="flex min-w-0 flex-grow items-center gap-2">
                                        <div className="h-3.5 w-20 shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800/60" />
                                        <span className="shrink-0 text-zinc-300 select-none dark:text-zinc-800/40">·</span>
                                        <div className="h-3 w-28 animate-pulse truncate rounded bg-zinc-200 dark:bg-zinc-800/60" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : avatars.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-4">
                        <Users className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">No team members yet</p>
                    </div>
                ) : (
                    <div className="max-h-[260px] overflow-y-auto pr-1">
                        <div className="space-y-1">
                            {avatars.slice(0, 5).map((avatar) => (
                                <AvatarRow key={avatar.id} avatar={avatar} />
                            ))}
                        </div>
                    </div>
                )}

                {showMoreCount > 0 ? (
                    <div className="mt-1.5 flex justify-center border-t border-zinc-100 pt-1.5 dark:border-zinc-800/60">
                        <span className="px-2.5 py-1 text-[11px] font-bold text-primary">
                            + {showMoreCount} more {showMoreCount === 1 ? "member" : "members"}
                        </span>
                    </div>
                ) : null}
            </div>
        </DashboardCard>
    );
});

export default TeamCard;
