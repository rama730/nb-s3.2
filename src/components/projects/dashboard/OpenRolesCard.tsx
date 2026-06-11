"use client";

import { memo, useMemo, useState, useCallback, useEffect } from "react";
import { Briefcase, CheckCircle, Clock, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import DashboardCard from "./DashboardCard";

import { type ApplicationStatusResult } from "@/app/actions/applications";

interface OpenRolesCardProps {
    roles: any[];
    isCreator: boolean;
    isCollaborator: boolean;
    applicationStatus: ApplicationStatusResult;
    onApply: (roleId?: string) => void;
    onManageRoles: () => void;
    onAcceptInvitation?: () => void;
    onDeclineInvitation?: () => void;
    invitationLoading?: boolean;
}

const parseWaitTime = (str: string): number => {
    const match = str.match(/(\d+)h\s*(\d+)m/);
    if (!match) return 0;
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    return (hours * 60 + minutes) * 60 * 1000;
};

const formatWaitTime = (ms: number): string => {
    const totalSecs = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
};

export default function OpenRolesCard({
    roles,
    isCreator,
    isCollaborator,
    applicationStatus,
    onApply,
    onManageRoles,
    onAcceptInvitation,
    onDeclineInvitation,
    invitationLoading = false,
}: OpenRolesCardProps) {
    const openRoles = useMemo(() => roles.filter((r: any) => {
        const remaining = (r?.count || 0) - (r?.filled || 0);
        return remaining > 0;
    }), [roles]);

    const isPending = applicationStatus.status === 'pending';
    const isRejected = applicationStatus.status === 'rejected';
    const isProposed = applicationStatus.status === 'proposed';
    const isRoleFilled = applicationStatus.lifecycleStatus === 'role_filled' || applicationStatus.decisionReason === 'role_filled';
    const canReapply = applicationStatus.canReapply ?? true;

    const [localWaitTimeMs, setLocalWaitTimeMs] = useState<number | null>(null);
    const [isApplyPending, setIsApplyPending] = useState(false);

    useEffect(() => {
        if (applicationStatus.waitTime) {
            setLocalWaitTimeMs(parseWaitTime(applicationStatus.waitTime));
        } else {
            setLocalWaitTimeMs(null);
        }
    }, [applicationStatus.waitTime]);

    useEffect(() => {
        if (localWaitTimeMs === null || localWaitTimeMs <= 0) return;

        const interval = setInterval(() => {
            setLocalWaitTimeMs((prev) => {
                if (prev === null) return null;
                const nextVal = prev - 1000;
                return nextVal <= 0 ? 0 : nextVal;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [localWaitTimeMs]);

    const isCooldownActive = localWaitTimeMs !== null && localWaitTimeMs > 0;
    const isBlocked = isPending || isProposed || (isRejected && !canReapply && isCooldownActive);

    const blockedReason = isPending
        ? "You already have an application pending review."
        : isProposed
            ? "You have a pending invitation. Review or decline it to apply for other roles."
            : (isRejected && !canReapply)
                ? (isRoleFilled ? "This role has been filled." : (isCooldownActive ? `You cannot reapply yet.` : null))
                : null;

    const cannotReapplyLabel = isRejected && !canReapply
        ? (isCooldownActive
            ? `Cannot reapply now • ${formatWaitTime(localWaitTimeMs || 0)} left`
            : "Cannot reapply")
        : null;

    const handleApply = useCallback((roleId?: string) => {
        if (isApplyPending || isBlocked) return;
        setIsApplyPending(true);
        onApply(roleId);
        setTimeout(() => setIsApplyPending(false), 800);
    }, [onApply, isApplyPending, isBlocked]);

    const visibleRoles = useMemo(() => openRoles.slice(0, 5), [openRoles]);
    const showMoreCount = openRoles.length - 5;

    const handleShowMore = useCallback(() => {
        if (isCreator) {
            onManageRoles();
        } else {
            handleApply();
        }
    }, [isCreator, onManageRoles, handleApply]);

    const jsonLd = useMemo(() => {
        if (openRoles.length === 0) return null;
        return {
            "@context": "https://schema.org",
            "@graph": openRoles.map((role) => ({
                "@type": "JobPosting",
                "@id": `role-${role.id}`,
                "title": role.role,
                "description": role.description || `Open position for ${role.role}`,
                "numberOfVacancies": (role.count || 1) - (role.filled || 0),
                "skills": role.skills?.join(", "),
            }))
        };
    }, [openRoles]);

    const isApplyDisabled = isBlocked || isApplyPending;

    return (
        <>
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
                />
            )}
            <DashboardCard
                title="Open Roles"
                icon={Briefcase}
                compact
            >
                <div className="space-y-3">
                    {blockedReason && (
                        <p id="open-roles-apply-disabled-reason" className="text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
                            {blockedReason}
                        </p>
                    )}

                    {/* Status Alert */}
                    {isCollaborator ? (
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-medium py-1 px-1">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Team member</span>
                        </div>
                    ) : isPending ? (
                        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-medium py-1 px-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Application pending review</span>
                        </div>
                    ) : isRejected && !canReapply ? (
                        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs font-medium py-1 px-1">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{isRoleFilled ? "Role filled" : cannotReapplyLabel || "Cannot reapply"}</span>
                        </div>
                    ) : null}

                    {/* Roles List */}
                    {openRoles.length > 0 ? (
                        <div className="max-h-[260px] overflow-y-auto pr-1 flex flex-col gap-1">
                            <div className="space-y-1">
                                {visibleRoles.map((role) => {
                                    const remaining = (role?.count || 0) - (role?.filled || 0);
                                    const isInteractive = !isCreator && !isCollaborator;
                                    const isThisProposedRole = isProposed && (role.id === applicationStatus.proposedRoleId || role.id === applicationStatus.roleId);
                                    const isThisAppliedRole = isPending && role.id === applicationStatus.roleId;

                                    const content = (
                                        <>
                                            <div className="flex-grow min-w-0">
                                                {/* Top Line: Title & Spots */}
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-semibold text-zinc-850 dark:text-zinc-200 group-hover:text-primary transition-colors truncate">
                                                        {role.role}
                                                    </span>
                                                    {isThisProposedRole && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                                            Invited
                                                        </span>
                                                    )}
                                                    {isThisAppliedRole && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                                            Applied
                                                        </span>
                                                    )}
                                                    <span className="text-zinc-400 dark:text-zinc-500 shrink-0 select-none">·</span>
                                                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
                                                        {remaining} spot{remaining !== 1 ? 's' : ''} left
                                                    </span>
                                                </div>

                                                {/* Description */}
                                                {role.description && (
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1 mb-1.5">
                                                        {role.description}
                                                    </p>
                                                )}

                                                {/* Skills tags */}
                                                {role.skills && role.skills.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {role.skills.slice(0, 3).map((skill: string) => (
                                                            <span
                                                                key={skill}
                                                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200/60 dark:border-zinc-700/60 transition-colors"
                                                            >
                                                                {skill}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Action indicator on the right */}
                                            {isInteractive && (
                                                <div className="ml-3 shrink-0 self-center flex items-center gap-1.5">
                                                    {isThisProposedRole ? (
                                                        <>
                                                            <button
                                                                type="button"
                                                                disabled={invitationLoading}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onAcceptInvitation?.();
                                                                }}
                                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white shadow-sm shadow-emerald-900/10 transition-all duration-200 active:scale-95 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                                                            >
                                                                {invitationLoading && (
                                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                                )}
                                                                Accept
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={invitationLoading}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onDeclineInvitation?.();
                                                                }}
                                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-850 dark:text-zinc-200 border border-zinc-200/60 dark:border-zinc-700/60 transition-all duration-200 active:scale-95 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                                                            >
                                                                Decline
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <span className={cn(
                                                            "inline-flex items-center px-2.5 py-1 text-[10px] font-bold rounded shadow-sm border transition-all",
                                                            isApplyDisabled
                                                                ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500"
                                                                : "bg-primary text-primary-foreground border-transparent hover:brightness-110"
                                                        )}>
                                                            {isThisAppliedRole ? 'Pending' : (isRejected && !canReapply) ? (isRoleFilled ? 'Filled' : 'Rejected') : 'Apply'}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );

                                    const isInteractiveRow = isInteractive && !isThisProposedRole;
                                    const className = isThisProposedRole
                                        ? "w-full flex items-start justify-between rounded-xl border border-amber-500/25 dark:border-amber-500/35 bg-amber-500/5 dark:bg-amber-500/10 p-3.5 cursor-default text-left my-2 first:mt-0 last:mb-0 transition-all duration-200"
                                        : cn(
                                            "w-full flex items-start justify-between py-2.5 px-2 border-b border-zinc-100 dark:border-zinc-800/65 last:border-b-0 text-left",
                                            isInteractiveRow
                                                ? "rounded-xl cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:bg-zinc-50 dark:focus-visible:bg-zinc-800/40 transition-all duration-150 group"
                                                : ""
                                        );

                                    if (isInteractiveRow) {
                                        return (
                                            <button
                                                key={role.id}
                                                type="button"
                                                onClick={() => handleApply(role.id)}
                                                disabled={isApplyDisabled}
                                                aria-disabled={isApplyDisabled}
                                                aria-describedby={isApplyDisabled ? "open-roles-apply-disabled-reason" : undefined}
                                                title={isApplyDisabled ? (blockedReason || "Application is currently unavailable") : `Apply for ${role.role}`}
                                                className={className}
                                            >
                                                {content}
                                            </button>
                                        );
                                    } else {
                                        return (
                                            <div key={role.id} className={className}>
                                                {content}
                                            </div>
                                        );
                                    }
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-4 text-xs text-zinc-400 dark:text-zinc-500 italic">
                            No open positions listed
                        </div>
                    )}

                    {showMoreCount > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/60 flex justify-center">
                            <button
                                type="button"
                                onClick={handleShowMore}
                                className="px-2.5 py-1 text-[11px] font-bold text-primary hover:underline transition-colors"
                            >
                                + {showMoreCount} more {showMoreCount === 1 ? "role" : "roles"}
                            </button>
                        </div>
                    )}

                    {/* Generic Apply Button */}
                    {!isCreator && !isCollaborator && !isProposed && (
                        <button
                            onClick={() => handleApply()}
                            disabled={isApplyDisabled}
                            aria-disabled={isApplyDisabled}
                            aria-describedby={isApplyDisabled ? "open-roles-apply-disabled-reason" : undefined}
                            title={isApplyDisabled ? (blockedReason || "Application is currently unavailable") : "Apply to this project"}
                            className={cn(
                                "w-full py-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg border transition-all",
                                isApplyDisabled
                                    ? "bg-zinc-50 dark:bg-zinc-900/40 border-zinc-100 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed"
                                    : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900/60 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/60 hover:border-zinc-300 dark:hover:bg-zinc-700 shadow-sm"
                            )}
                        >
                            {isPending
                                ? "Application Submitted"
                                : isProposed
                                    ? "Invitation Pending"
                                : (isRejected && !canReapply)
                                    ? (isRoleFilled ? "Role filled" : cannotReapplyLabel || "Cannot reapply")
                                : "Apply General"}
                        </button>
                    )}
                    {isCreator && (
                        <button
                            onClick={onManageRoles}
                            className="w-full py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-150 shadow-sm"
                        >
                            Manage roles
                        </button>
                    )}
                </div>
            </DashboardCard>
        </>
    );
}
