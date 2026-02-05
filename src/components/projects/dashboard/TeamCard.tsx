"use client";

import Image from "next/image";
import Link from "next/link";
import { Users, Plus, Star } from "lucide-react"; // Star for crown/creator badge
import { profileHref } from "@/lib/routing/identifiers";
import DashboardCard from "./DashboardCard";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AvatarWithFallbackProps {
    src?: string | null;
    alt?: string;
    fallback: string;
    className?: string;
}

function AvatarWithFallback({ src, alt, fallback, className }: AvatarWithFallbackProps) {
    if (src) {
        return (
            <Image
                src={src}
                alt={alt || "Avatar"}
                width={32}
                height={32}
                className={cn("rounded-full object-cover", className)}
            />
        );
    }
    return (
        <div className={cn("rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold", className)}>
            {(fallback || "?")[0]?.toUpperCase()}
        </div>
    );
}

interface TeamCardProps {
    project: any;
    members: any[];
    openRoles: any[];
    isCreator: boolean;
    onManageTeam: () => void;
    onInvite: () => void;
    hasNextMembers?: boolean;
    fetchNextMembers?: () => void;
    loadingMembers?: boolean;
}

export default function TeamCard({
    project,
    members,
    openRoles,
    isCreator,
    onManageTeam,
    onInvite,
    hasNextMembers,
    fetchNextMembers,
    loadingMembers,
}: TeamCardProps) {

    // Ghost slots logic
    const openRoleSlots = openRoles.flatMap(role => {
        const remaining = Math.max(0, (role?.count || 0) - (role?.filled || 0));
        return Array(remaining).fill(role);
    });

    return (
        <DashboardCard
            title="The Team"
            icon={Users}
            compact
            className="flex flex-col h-fit"
            action={isCreator && (
                <button
                    onClick={onInvite}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Invite
                </button>
            )}
        >
            <motion.div className="space-y-2 overflow-y-auto pr-1 max-h-[600px]">
                <div className="grid grid-cols-1 gap-1.5">
                    {/* Creator / Owner */}
                    {project?.owner && (
                        <Link
                            href={profileHref({ id: project.owner.id, username: project.owner.username || undefined })}
                            className="flex items-center gap-3 p-1.5 rounded-lg bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/20 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors group"
                        >
                            <div className="relative">
                                <AvatarWithFallback
                                    src={project.owner.avatarUrl}
                                    fallback={project.owner.fullName || project.owner.username || "C"}
                                    className="w-7 h-7"
                                />
                                <div className="absolute -top-1 -right-1 bg-yellow-400 text-white rounded-full p-[2px] border border-white dark:border-zinc-900">
                                    <Star className="w-2 h-2 fill-current" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    {project.owner.fullName || project.owner.username}
                                </p>
                                <p className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                                    Project Lead
                                </p>
                            </div>
                        </Link>
                    )}

                    {/* Collaborators */}
                    {members.filter((m: any) => m?.id && m.id !== project?.owner?.id).map((member: any) => (
                        <Link
                            key={member.id}
                            href={profileHref({ id: member.id, username: member.username || undefined })}
                            className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors group"
                        >
                            <AvatarWithFallback
                                src={member.avatarUrl}
                                fallback={member.fullName || member.username || "M"}
                                className="w-7 h-7"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    {member.fullName || member.username || "Member"}
                                </p>
                                <p className="text-[9px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                                    {member.membershipRole || "Team Member"}
                                </p>
                            </div>
                        </Link>
                    ))}

                    {/* Infinite Loading: Load More Actions */}
                    {hasNextMembers && (
                        <button
                            onClick={fetchNextMembers}
                            disabled={loadingMembers}
                            className="w-full mt-1 p-2 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-all border border-indigo-100 dark:border-indigo-900/20 flex items-center justify-center gap-2"
                        >
                            {loadingMembers ? (
                                <>
                                    <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                "Load More Members"
                            )}
                        </button>
                    )}

                    {/* Ghost Slots for Open Roles - Compact */}
                    {openRoleSlots.map((role, idx) => (
                        <div
                            key={`ghost-${role.id}-${idx}`}
                            className="flex items-center gap-3 p-1.5 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer group"
                            onClick={onInvite} // Or expand role details
                        >
                            <div className="w-7 h-7 rounded-full bg-zinc-50 dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-zinc-400">
                                <Plus className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">
                                    Hiring: {role.role}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Invite Button (if creator and no open slots shown or just extra CTA) */}
                {isCreator && onInvite && openRoleSlots.length === 0 && (
                    <button
                        onClick={onInvite}
                        className="w-full mt-2 py-1.5 flex items-center justify-center gap-1.5 text-[10px] font-medium text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                        <Plus className="w-3 h-3" />
                        Invite team member
                    </button>
                )}
            </motion.div>
        </DashboardCard>
    );
}
