"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWorkspaceJoinRequestsAction } from "@/app/actions/workspace";
import { acceptApplicationAction, rejectApplicationAction } from "@/app/actions/applications";
import { useUIStore } from "@/lib/stores/ui-store";
import { Loader2, User, Check, X, ShieldAlert, ArrowRight, MessageSquareCode } from "lucide-react";
import { toast } from "sonner";

interface WorkspaceMembersTabProps {
    isActive?: boolean;
}

export default function WorkspaceMembersTab({ isActive = true }: WorkspaceMembersTabProps) {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const queryClient = useQueryClient();
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Fetch incoming join requests, enabled ONLY when drawer is open and tab is active
    const { data, isLoading, error } = useQuery({
        queryKey: ["workspace", "members"],
        queryFn: () => fetchWorkspaceJoinRequestsAction(),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });

    const applications = data?.applications || [];

    // Accept Mutation
    const acceptMutation = useMutation({
        mutationFn: async ({ id }: { id: string }) => {
            setProcessingId(id);
            const res = await acceptApplicationAction(id);
            if (!res.success) throw new Error("error" in res ? res.error : "Failed to accept");
            return res;
        },
        onSuccess: () => {
            toast.success("Application accepted successfully!");
            queryClient.invalidateQueries({ queryKey: ["workspace", "members"] });
        },
        onError: (err: any) => {
            toast.error(err.message || "Failed to accept application");
        },
        onSettled: () => {
            setProcessingId(null);
        }
    });

    // Decline Mutation
    const declineMutation = useMutation({
        mutationFn: async ({ id }: { id: string }) => {
            setProcessingId(id);
            const res = await rejectApplicationAction(id);
            if (!res.success) throw new Error("error" in res ? res.error : "Failed to decline");
            return res;
        },
        onSuccess: () => {
            toast.success("Application declined");
            queryClient.invalidateQueries({ queryKey: ["workspace", "members"] });
        },
        onError: (err: any) => {
            toast.error(err.message || "Failed to decline application");
        },
        onSettled: () => {
            setProcessingId(null);
        }
    });

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading requests...</span>
            </div>
        );
    }

    if (error || (data && !data.success)) {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-center dark:border-rose-900/30 dark:bg-rose-950/20">
                <p className="text-xs font-medium text-rose-800 dark:text-rose-400">
                    Failed to load requests. Please try again later.
                </p>
            </div>
        );
    }

    if (applications.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/10 px-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                    <User className="w-5 h-5" />
                </div>
                <h4 className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">No Pending Requests</h4>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 max-w-xs">
                    You have no active member requests seeking to join your projects.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 max-h-[320px] overflow-y-auto pr-1">
            {applications.map((app: any) => {
                const applicantName = app.applicant?.fullName || app.applicant?.username || "Collaborator";
                const isCurrentProcessing = processingId === app.id;

                return (
                    <div
                        key={app.id}
                        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 space-y-4"
                    >
                        {/* Applicant header info */}
                        <div className="flex items-center gap-3">
                            {app.applicant?.avatarUrl ? (
                                <img
                                    src={app.applicant.avatarUrl}
                                    alt={applicantName}
                                    className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-800"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                                    <User className="w-5 h-5" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h5 className="font-semibold text-sm text-zinc-950 dark:text-zinc-50 truncate">
                                    {applicantName}
                                </h5>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                    @{app.applicant?.username || "anonymous"}
                                </p>
                            </div>
                        </div>

                        {/* Project Role Application Specs */}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-3.5 space-y-2 border border-zinc-100 dark:border-zinc-800/40">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-zinc-800 dark:text-zinc-300">Project:</span>
                                <span className="text-blue-500">{app.project?.title}</span>
                                <span className="font-mono text-[9px] uppercase bg-zinc-200/60 dark:bg-zinc-800 px-1 rounded">
                                    {app.project?.key}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-zinc-800 dark:text-zinc-300">Role:</span>
                                <span className="font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1">
                                    {app.role?.role || "Contributor"}
                                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
                                </span>
                            </div>
                        </div>

                        {/* Message */}
                        {app.message && (
                            <div className="space-y-1">
                                <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                                    <MessageSquareCode className="w-3.5 h-3.5" />
                                    Cover Message
                                </p>
                                <p className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50/50 dark:bg-zinc-950/20 rounded-xl p-3 border border-dashed border-zinc-200 dark:border-zinc-900 leading-relaxed italic">
                                    "{app.message}"
                                </p>
                            </div>
                        )}

                        {/* Buttons Action Bar */}
                        <div className="flex items-center gap-3 border-t border-zinc-100 dark:border-zinc-800/60 pt-4">
                            <button
                                type="button"
                                disabled={isCurrentProcessing || !!processingId}
                                onClick={() => acceptMutation.mutate({ id: app.id })}
                                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                            >
                                {isCurrentProcessing && acceptMutation.isPending ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Check className="w-3.5 h-3.5" />
                                )}
                                Approve
                            </button>
                            <button
                                type="button"
                                disabled={isCurrentProcessing || !!processingId}
                                onClick={() => declineMutation.mutate({ id: app.id })}
                                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                            >
                                {isCurrentProcessing && declineMutation.isPending ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <X className="w-3.5 h-3.5" />
                                )}
                                Decline
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
