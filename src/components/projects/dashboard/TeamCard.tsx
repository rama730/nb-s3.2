"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Users, Plus, Star } from "lucide-react";
import { profileHref } from "@/lib/routing/identifiers";
import DashboardCard from "./DashboardCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarGroup, AvatarGroupTooltip } from "@/components/animate-ui/components/animate/avatar-group";

interface TeamCardProps {
    project: any;
    members: any[];
    isCreator: boolean;
    onInvite: () => void;
    hasNextMembers?: boolean;
    fetchNextMembers?: () => void;
    loadingMembers?: boolean;
}

type TeamEntry = {
    id: string;
    fullName: string;
    avatarUrl?: string | null;
    roleLabel: string;
    isOwner: boolean;
    href: string;
    sortDateMs?: number;
    presenceStatus?: string;
};

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

const toPresence = (raw: unknown): string | undefined => {
    if (typeof raw !== "string") return undefined;
    const value = raw.trim().toLowerCase();
    if (!value) return undefined;
    if (value.includes("online")) return "online";
    if (value.includes("active")) return "active";
    if (value.includes("away") || value.includes("idle")) return "away";
    if (value.includes("offline")) return "offline";
    return value;
};

const statusRingClass = (status?: string, isOwner?: boolean) => {
    if (status === "online") return "ring-emerald-500/70";
    if (status === "active") return "ring-blue-500/70";
    if (status === "away") return "ring-amber-500/70";
    if (status === "offline") return "ring-zinc-400/60 dark:ring-zinc-600/70";
    if (isOwner) return "ring-indigo-500/70";
    return "ring-zinc-300/70 dark:ring-zinc-700";
};

export default function TeamCard({
    project,
    members,
    isCreator,
    onInvite,
    hasNextMembers,
    fetchNextMembers,
    loadingMembers,
}: TeamCardProps) {
    const reduceMotion = useReducedMotion();
    const [isOverflowTooltipOpen, setIsOverflowTooltipOpen] = useState(false);

    const rawLeadFocus = project?.importSource?.metadata?.leadFocus;
    const leadFocus = typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";
    const ownerRoleLabel = leadFocus ? `LEAD / ${leadFocus}` : "LEAD";
    const ownerName = project?.owner?.fullName || project?.owner?.username || "Creator";

    const teamEntries = useMemo<TeamEntry[]>(() => {
        const ownerEntry: TeamEntry[] = project?.owner?.id
            ? [{
                id: project.owner.id,
                fullName: ownerName,
                avatarUrl: project.owner.avatarUrl,
                roleLabel: ownerRoleLabel,
                isOwner: true,
                href: profileHref({ id: project.owner.id, username: project.owner.username || undefined }),
                presenceStatus: toPresence(project.owner?.presenceStatus) ?? "offline",
            }]
            : [];

        const collaborators = (members || [])
            .filter((m: any) => m?.id && m.id !== project?.owner?.id)
            .map((member: any) => {
                const roleLabel = member.projectRoleTitle || member.membershipRole || "Team Member";
                const joinedAtMs = member.joinedAt ? new Date(member.joinedAt).getTime() : undefined;
                const presenceStatus =
                    toPresence(member.presenceStatus) ||
                    toPresence(member.status) ||
                    (member.isOnline === true ? "online" : member.isOnline === false ? "offline" : undefined) ||
                    "offline";

                return {
                    id: member.id,
                    fullName: member.fullName || member.username || "Member",
                    avatarUrl: member.avatarUrl,
                    roleLabel,
                    isOwner: false,
                    href: profileHref({ id: member.id, username: member.username || undefined }),
                    sortDateMs: Number.isFinite(joinedAtMs) ? joinedAtMs : undefined,
                    presenceStatus,
                } as TeamEntry;
            })
            .sort((a, b) => {
                if (a.sortDateMs && b.sortDateMs) return b.sortDateMs - a.sortDateMs;
                if (a.sortDateMs) return -1;
                if (b.sortDateMs) return 1;
                return a.fullName.localeCompare(b.fullName);
            });

        return [...ownerEntry, ...collaborators];
    }, [members, ownerName, ownerRoleLabel, project]);

    const MAX_VISIBLE_AVATARS = 10;
    const HIDDEN_TOOLTIP_PREVIEW_LIMIT = 5;
    const visibleTeamEntries = teamEntries.slice(0, MAX_VISIBLE_AVATARS);
    const hiddenTeamEntries = teamEntries.slice(MAX_VISIBLE_AVATARS);
    const hiddenCount = hiddenTeamEntries.length;
    const hiddenPreviewMembers = hiddenTeamEntries.slice(0, HIDDEN_TOOLTIP_PREVIEW_LIMIT);
    const hiddenRemainingCount = Math.max(0, hiddenCount - hiddenPreviewMembers.length);

    return (
        <DashboardCard
            title="The Team"
            icon={Users}
            compact
            className="flex flex-col h-fit"
            action={isCreator && (
                <button
                    onClick={onInvite}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 rounded transition-all opacity-65 hover:opacity-100 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Invite
                </button>
            )}
        >
            <div className="py-2">
                <AnimatePresence mode="wait" initial={false}>
                    {loadingMembers && teamEntries.length === 0 ? (
                        <motion.div
                            key="team-skeleton"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex justify-center -space-x-2 md:-space-x-3"
                        >
                            {Array.from({ length: 4 }).map((_, idx) => (
                                <div
                                    key={idx}
                                    className="size-10 md:size-12 rounded-full border-2 md:border-3 border-background bg-zinc-200 dark:bg-zinc-800 animate-pulse"
                                />
                            ))}
                        </motion.div>
                    ) : teamEntries.length === 0 ? (
                        <motion.div
                            key="team-empty"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.16 }}
                            className="flex flex-col items-center gap-2"
                        >
                            <Avatar className="size-10 md:size-12 border-2 md:border-3 border-background ring-1 ring-zinc-300/70 dark:ring-zinc-700">
                                <AvatarFallback className="text-xs font-semibold">--</AvatarFallback>
                            </Avatar>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">No team members yet</p>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="team-avatars"
                            initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: reduceMotion ? 0 : -2 }}
                            transition={{ duration: 0.16 }}
                        >
                            <AvatarGroup className="w-full justify-center -space-x-2 md:-space-x-3">
                                {visibleTeamEntries.map((member, index) => (
                                    <Link
                                        key={member.id}
                                        href={member.href}
                                        aria-label={`${member.fullName} profile`}
                                        className="group relative inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-[margin] duration-150 motion-reduce:transition-none hover:mx-0.5"
                                    >
                                        <motion.div
                                            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.14, delay: reduceMotion ? 0 : index * 0.05 }}
                                            className="relative transition-transform duration-150 ease-out motion-reduce:transition-none group-hover:-translate-y-0.5"
                                        >
                                            <div className="relative">
                                                <Avatar
                                                    className={`size-10 md:size-12 border-2 md:border-3 border-background ring-1 ${statusRingClass(member.presenceStatus, member.isOwner)} shadow-sm transition-shadow duration-150 motion-reduce:transition-none group-hover:shadow-md`}
                                                >
                                                    <AvatarImage src={member.avatarUrl || undefined} alt={member.fullName} />
                                                    <AvatarFallback className="text-[10px] md:text-[11px] font-semibold">
                                                        {toInitials(member.fullName)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                {member.isOwner && (
                                                    <span className="absolute -top-1 -right-1 bg-yellow-400 text-white rounded-full p-[2px] border border-white dark:border-zinc-900">
                                                        <Star className="w-2.5 h-2.5 fill-current" />
                                                    </span>
                                                )}
                                            </div>
                                        </motion.div>
                                        <AvatarGroupTooltip>
                                            <div className="w-44 text-left leading-tight">
                                                <p className="font-medium truncate">{member.fullName}</p>
                                                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                                    {shortenRoleLabel(member.roleLabel)}
                                                </p>
                                            </div>
                                        </AvatarGroupTooltip>
                                    </Link>
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
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                setIsOverflowTooltipOpen((current) => !current);
                                                return;
                                            }
                                            if (event.key === "Escape") {
                                                event.preventDefault();
                                                setIsOverflowTooltipOpen(false);
                                            }
                                        }}
                                        className="size-10 md:size-12 border-2 md:border-3 border-background ring-1 ring-zinc-300/70 dark:ring-zinc-700 bg-zinc-100 dark:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                    >
                                        <AvatarFallback className="text-[10px] md:text-[11px] font-semibold">
                                            +{hiddenCount}
                                        </AvatarFallback>
                                        <AvatarGroupTooltip open={isOverflowTooltipOpen} onOpenChange={setIsOverflowTooltipOpen}>
                                            <div className="w-52 max-h-44 overflow-y-auto text-left leading-tight pr-1" role="status" aria-live="polite">
                                                <p className="font-medium">+{hiddenCount} more team member{hiddenCount === 1 ? "" : "s"}</p>
                                                <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                                    {hiddenPreviewMembers.map((member) => (
                                                        <li key={member.id} className="truncate">
                                                            {member.fullName}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {hiddenRemainingCount > 0 && (
                                                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                                        and {hiddenRemainingCount} more
                                                    </p>
                                                )}
                                            </div>
                                        </AvatarGroupTooltip>
                                    </Avatar>
                                )}
                            </AvatarGroup>
                        </motion.div>
                    )}
                </AnimatePresence>

                {hasNextMembers && fetchNextMembers && (
                    <div className="mt-3 flex justify-center">
                        <button
                            onClick={fetchNextMembers}
                            disabled={loadingMembers}
                            className="px-2 py-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200/80 dark:border-indigo-900/50 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-60"
                        >
                            {loadingMembers ? "Loading..." : "Load more"}
                        </button>
                    </div>
                )}
            </div>
        </DashboardCard>
    );
}
