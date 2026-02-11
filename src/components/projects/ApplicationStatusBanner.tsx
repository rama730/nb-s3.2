"use client";

import React from "react";
import { Clock, CheckCircle2, XCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ApplicationStatusBannerProps {
    status: "none" | "pending" | "accepted" | "rejected";
    roleTitle?: string;
    canReapply?: boolean;
    waitTime?: string;
    onApply?: () => void;
    isOwner?: boolean;
    isMember?: boolean;
}

export default function ApplicationStatusBanner({
    status,
    roleTitle,
    canReapply,
    waitTime,
    onApply,
    isOwner,
    isMember,
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
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        You are a Team Member!
                    </p>
                    <p className="text-sm text-zinc-500">
                        Role: <span className="font-medium">{roleTitle}</span>
                    </p>
                </div>
            </div>
        );
    }

    // Rejected
    if (status === "rejected") {
        return (
            <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                        <XCircle className="w-5 h-5 text-zinc-500" />
                    </div>
                    <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                            Application Not Accepted
                        </p>
                        <p className="text-sm text-zinc-500">
                            {canReapply
                                ? "You can apply again now"
                                : `You can apply again in: ${waitTime}`}
                        </p>
                    </div>
                </div>
                {canReapply && (
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
