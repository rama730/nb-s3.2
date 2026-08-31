"use client";

import { Briefcase, CheckCircle, Clock, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import DashboardCard from "./DashboardCard";
import { SkillList } from "@/components/skills/SkillList";
import {
    experienceLevelLabel,
    rolePreferenceLabel,
    weeklyCapacityLabel,
} from "@/lib/profile/role-preferences";
import { type ApplicationStatusResult } from "@/app/actions/applications";

interface OpenRolesCardProps {
    roles: any[];
    isCreator: boolean;
    isCollaborator: boolean;
    applicationStatus: ApplicationStatusResult;
    onApply: (role?: any) => void;
    onManageRoles: () => void;
    onAcceptInvitation?: () => void;
    onDeclineInvitation?: () => void;
    invitationLoading?: boolean;
}

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
    const openRoles = roles.filter((role: any) => {
        const remaining = (role?.count || 0) - (role?.filled || 0);
        return remaining > 0;
    });

    const isPending = applicationStatus.status === "pending";
    const isRejected = applicationStatus.status === "rejected";
    const isProposed = applicationStatus.status === "proposed";
    const isGuidanceInvitation = isProposed && applicationStatus.invitationKind === "guidance_appointment";
    const invitationTitle = applicationStatus.proposedRoleTitle || applicationStatus.roleTitle || "Guide";
    const isRoleFilled = applicationStatus.lifecycleStatus === "role_filled" || applicationStatus.decisionReason === "role_filled";
    const canReapply = applicationStatus.canReapply ?? true;
    const isBlocked = isPending || isProposed || (isRejected && !canReapply);
    const waitTime = applicationStatus.waitTime;

    const blockedReason = isPending
        ? "You already have an application pending review."
        : isProposed
            ? `You have a pending ${invitationTitle} invitation. Review or decline it to apply for other roles.`
            : isRejected && !canReapply
                ? isRoleFilled
                    ? "This role has been filled."
                    : waitTime
                        ? `You can reapply in ${waitTime}.`
                        : "You cannot reapply yet."
                : null;

    const cannotReapplyLabel = isRejected && !canReapply
        ? isRoleFilled
            ? "Role filled"
            : waitTime
                ? `Cannot reapply • ${waitTime}`
                : "Cannot reapply"
        : null;
    const isApplyDisabled = isBlocked;
    const showMoreCount = openRoles.length - 10;

    return (
        <DashboardCard title="Open Roles" icon={Briefcase} compact>
            <div className="space-y-3">
                {blockedReason ? (
                    <p id="open-roles-apply-disabled-reason" className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {blockedReason}
                    </p>
                ) : null}

                {isCollaborator ? (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="h-3.5 w-3.5" />
                        <span>Team member</span>
                    </div>
                ) : isPending ? (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Application pending review</span>
                    </div>
                ) : isRejected && !canReapply ? (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                        <XCircle className="h-3.5 w-3.5" />
                        <span>{cannotReapplyLabel || "Cannot reapply"}</span>
                    </div>
                ) : null}

                {isGuidanceInvitation ? (
                    <div className="flex w-full items-start justify-between rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5 text-left dark:border-amber-500/35 dark:bg-amber-500/10">
                        <div className="min-w-0 flex-grow">
                            <div className="mb-1 flex items-center gap-2">
                                <span className="truncate text-sm font-semibold text-zinc-850 dark:text-zinc-200">
                                    {invitationTitle}
                                </span>
                                <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                    Invited
                                </span>
                            </div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Leadership appointment for this project.
                            </p>
                        </div>
                        {!isCreator && !isCollaborator ? (
                            <div className="ml-3 flex shrink-0 items-center gap-1.5 self-center">
                                <button
                                    type="button"
                                    disabled={invitationLoading}
                                    onClick={() => onAcceptInvitation?.()}
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-900/10 transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 dark:bg-emerald-500"
                                >
                                    {invitationLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                    Accept
                                </button>
                                <button
                                    type="button"
                                    disabled={invitationLoading}
                                    onClick={() => onDeclineInvitation?.()}
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-200/60 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-850 transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700/60 dark:bg-zinc-800 dark:text-zinc-200"
                                >
                                    Decline
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {openRoles.length > 0 ? (
                    <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto pr-1">
                        <div className="space-y-1">
                            {openRoles.slice(0, 10).map((role) => {
                                const remaining = (role?.count || 0) - (role?.filled || 0);
                                const isInteractive = !isCreator && !isCollaborator;
                                const isThisProposedRole = isProposed && (role.id === applicationStatus.proposedRoleId || role.id === applicationStatus.roleId);
                                const isThisAppliedRole = isPending && role.id === applicationStatus.roleId;
                                const content = (
                                    <>
                                        <div className="min-w-0 flex-grow">
                                            <div className="mb-1 flex items-center gap-2">
                                                <span className="truncate text-sm font-semibold text-zinc-850 transition-colors group-hover:text-primary dark:text-zinc-200">
                                                    {role.role}
                                                </span>
                                                {isThisProposedRole ? (
                                                    <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                                        Invited
                                                    </span>
                                                ) : null}
                                                {isThisAppliedRole ? (
                                                    <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                                        Applied
                                                    </span>
                                                ) : null}
                                                <span className="shrink-0 text-zinc-400 select-none dark:text-zinc-500">·</span>
                                                <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    {remaining} spot{remaining !== 1 ? "s" : ""} left
                                                </span>
                                            </div>

                                            {(role.commitmentType || role.experienceRequired || role.hoursPerWeek) ? (
                                                <div className="mb-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-450">
                                                    {role.commitmentType ? (
                                                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800/80">
                                                            {rolePreferenceLabel(role.commitmentType) || role.commitmentType}
                                                        </span>
                                                    ) : null}
                                                    {role.experienceRequired ? (
                                                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800/80">
                                                            {experienceLevelLabel(role.experienceRequired) || role.experienceRequired}
                                                        </span>
                                                    ) : null}
                                                    {role.hoursPerWeek ? (
                                                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800/80">
                                                            {weeklyCapacityLabel(role.hoursPerWeek) || role.hoursPerWeek}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}

                                            {role.description ? (
                                                <p className="mb-1.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                                                    {role.description}
                                                </p>
                                            ) : null}

                                            {role.skills?.length > 0 ? (
                                                <SkillList skills={role.skills} maxVisible={3} size="sm" />
                                            ) : null}
                                        </div>

                                        {isInteractive ? (
                                            <div className="ml-3 flex shrink-0 items-center gap-1.5 self-center">
                                                {isThisProposedRole ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            disabled={invitationLoading}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onAcceptInvitation?.();
                                                            }}
                                                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-900/10 transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 dark:bg-emerald-500"
                                                        >
                                                            {invitationLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                                            Accept
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={invitationLoading}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onDeclineInvitation?.();
                                                            }}
                                                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-200/60 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-850 transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700/60 dark:bg-zinc-800 dark:text-zinc-200"
                                                        >
                                                            Decline
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span
                                                        className={cn(
                                                            "inline-flex rounded border px-2.5 py-1 text-[10px] font-bold shadow-sm transition-all",
                                                            isApplyDisabled
                                                                ? "border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500"
                                                                : "border-transparent bg-primary text-primary-foreground hover:brightness-110",
                                                        )}
                                                    >
                                                        {isThisAppliedRole ? "Pending" : isRejected && !canReapply ? (isRoleFilled ? "Filled" : "Rejected") : "Apply"}
                                                    </span>
                                                )}
                                            </div>
                                        ) : null}
                                    </>
                                );
                                const isInteractiveRow = isInteractive && !isThisProposedRole;
                                const className = isThisProposedRole
                                    ? "my-2 flex w-full cursor-default items-start justify-between rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5 text-left transition-all duration-200 first:mt-0 last:mb-0 dark:border-amber-500/35 dark:bg-amber-500/10"
                                    : cn(
                                        "flex w-full items-start justify-between border-b border-zinc-100 px-2 py-2.5 text-left last:border-b-0 dark:border-zinc-800/65",
                                        isInteractiveRow
                                            ? "group cursor-pointer rounded-xl transition-all duration-150 hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none   dark:hover:bg-zinc-800/40 dark:focus-visible:bg-zinc-800/40"
                                            : "",
                                    );

                                return isInteractiveRow ? (
                                    <button
                                        key={role.id}
                                        type="button"
                                        onClick={() => onApply(role)}
                                        disabled={isApplyDisabled}
                                        aria-disabled={isApplyDisabled}
                                        aria-describedby={isApplyDisabled ? "open-roles-apply-disabled-reason" : undefined}
                                        title={isApplyDisabled ? (blockedReason || "Application is currently unavailable") : `Apply for ${role.role}`}
                                        className={className}
                                    >
                                        {content}
                                    </button>
                                ) : (
                                    <div key={role.id} className={className}>
                                        {content}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : !isGuidanceInvitation ? (
                    <div className="py-4 text-center text-xs italic text-zinc-400 dark:text-zinc-500">
                        No open positions listed
                    </div>
                ) : null}

                {showMoreCount > 0 ? (
                    <div className="mt-1.5 flex justify-center border-t border-zinc-100 pt-1.5 dark:border-zinc-800/60">
                        {isCreator ? (
                            <button type="button" onClick={onManageRoles} className="px-2.5 py-1 text-[11px] font-bold text-primary transition-colors hover:underline">
                                + {showMoreCount} more {showMoreCount === 1 ? "role" : "roles"}
                            </button>
                        ) : (
                            <span className="px-2.5 py-1 text-[11px] font-bold text-primary">
                                + {showMoreCount} more {showMoreCount === 1 ? "role" : "roles"}
                            </span>
                        )}
                    </div>
                ) : null}

                {openRoles.length === 0 && !isCreator && !isCollaborator && !isProposed ? (
                    <button
                        type="button"
                        onClick={() => onApply()}
                        disabled={isApplyDisabled}
                        aria-disabled={isApplyDisabled}
                        aria-describedby={isApplyDisabled ? "open-roles-apply-disabled-reason" : undefined}
                        title={isApplyDisabled ? (blockedReason || "Application is currently unavailable") : "Apply to this project"}
                        className={cn(
                            "flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-all",
                            isApplyDisabled
                                ? "cursor-not-allowed border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500"
                                : "border-zinc-200 bg-white text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800/60",
                        )}
                    >
                        {isPending
                            ? "Application Submitted"
                            : isRejected && !canReapply
                                ? cannotReapplyLabel || "Cannot reapply"
                                : "Apply to project"}
                    </button>
                ) : null}

                {isCreator ? (
                    <button
                        type="button"
                        onClick={onManageRoles}
                        className="w-full rounded-lg border border-zinc-200 py-2 text-xs font-semibold text-zinc-600 shadow-sm transition-all duration-150 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
                    >
                        Manage roles
                    </button>
                ) : null}
            </div>
        </DashboardCard>
    );
}
