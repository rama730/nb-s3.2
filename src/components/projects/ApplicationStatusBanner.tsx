"use client";

import React from "react";
import { Clock, CheckCircle2, XCircle, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ApplicationStatusBannerProps {
    status: "none" | "pending" | "accepted" | "rejected" | "withdrawn" | "proposed";
    lifecycleStatus?: "none" | "pending" | "accepted" | "rejected" | "withdrawn" | "proposed" | "role_filled";
    decisionReason?: string | null;
    roleTitle?: string;
    canReapply?: boolean;
    waitTime?: string;
    membershipEnded?: boolean;
    onApply?: () => void;
    isOwner?: boolean;
    isMember?: boolean;
    onAccept?: () => void;
    onDecline?: () => void;
    loading?: boolean;
}

export default function ApplicationStatusBanner({
    status,
    lifecycleStatus,
    decisionReason,
    roleTitle,
    canReapply,
    waitTime,
    membershipEnded,
    onApply,
    isOwner,
    isMember,
    onAccept,
    onDecline,
    loading = false,
}: ApplicationStatusBannerProps) {
    // Don't show for owner or existing member
    if (isOwner || isMember) return null;

    // No application - show apply button
    if (status === "none") {
        return (
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                        <Send className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                            Interested in joining?
                        </p>
                        <p className="text-sm text-zinc-500">
                            Apply to become a team member
                        </p>
                    </div>
                </div>
                <Button
                    onClick={onApply}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                    Apply to Join
                </Button>
            </div>
        );
    }

    // Withdrawn application
    if (status === "withdrawn" || lifecycleStatus === "withdrawn" || decisionReason === "withdrawn_by_applicant") {
        return (
            <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                        <XCircle className="w-5 h-5 text-zinc-500" />
                    </div>
                    <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                            Application Withdrawn
                        </p>
                        <p className="text-sm text-zinc-500">
                            You withdrew this application.
                        </p>
                    </div>
                </div>
                <Button
                    onClick={onApply}
                    variant="outline"
                    className="border-zinc-300 dark:border-zinc-600"
                >
                    Apply Again
                </Button>
            </div>
        );
    }

    // Proposed role change
    if (status === "proposed") {
        return (
            <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm md:text-base">
                            Project Invitation Received
                        </p>
                        <p className="text-xs md:text-sm text-zinc-550 dark:text-zinc-400">
                            You have been invited to join the project as <span className="font-bold text-amber-600 dark:text-amber-400">{roleTitle || "a collaborator"}</span>.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        size="sm"
                        onClick={onAccept}
                        disabled={loading}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
                    >
                        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Accept
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onDecline}
                        disabled={loading}
                        className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold text-xs rounded-xl"
                    >
                        Decline
                    </Button>
                </div>
            </div>
        );
    }

    // Pending application
    if (status === "pending") {
        return (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        Application Pending
                    </p>
                    <p className="text-sm text-zinc-500">
                        You applied for: <span className="font-medium">{roleTitle}</span>
                    </p>
                </div>
            </div>
        );
    }

    // Accepted
    if (status === "accepted") {
        return (
            <div className={`flex items-center gap-3 rounded-xl border p-4 ${membershipEnded ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20" : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"}`}>
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${membershipEnded ? "bg-amber-100 dark:bg-amber-900/50" : "bg-emerald-100 dark:bg-emerald-900/50"}`}>
                    <CheckCircle2 className={`h-5 w-5 ${membershipEnded ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`} />
                </div>
                <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {membershipEnded ? "Accepted · Membership ended" : "You are a Team Member!"}
                    </p>
                    <p className="text-sm text-zinc-500">
                        {membershipEnded ? "Your accepted application remains in history, but active project access has ended." : <>Role: <span className="font-medium">{roleTitle}</span></>}
                    </p>
                </div>
            </div>
        );
    }

    // Rejected
    if (status === "rejected") {
        const isRoleFilled = lifecycleStatus === "role_filled" || decisionReason === "role_filled";
        const isWithdrawn = (lifecycleStatus as string) === "withdrawn" || decisionReason === "withdrawn_by_applicant";
        return (
            <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                        <XCircle className="w-5 h-5 text-zinc-500" />
                    </div>
                    <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                            {isRoleFilled ? "Role Filled" : isWithdrawn ? "Application Withdrawn" : "Application Not Accepted"}
                        </p>
                        <p className="text-sm text-zinc-500">
                            {isRoleFilled
                                ? "The role was filled. You can apply for other open roles."
                                : isWithdrawn
                                    ? "You withdrew this application."
                                    : canReapply
                                        ? "You can apply again now"
                                        : waitTime
                                            ? `You can apply again in: ${waitTime}`
                                            : "You cannot reapply at this time"}
                        </p>
                    </div>
                </div>
                {canReapply && !isWithdrawn && !isRoleFilled && (
                    <Button
                        onClick={onApply}
                        variant="outline"
                        className="border-zinc-300 dark:border-zinc-600"
                    >
                        Apply Again
                    </Button>
                )}
            </div>
        );
    }

    return null;
}
