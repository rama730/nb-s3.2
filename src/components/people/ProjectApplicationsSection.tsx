"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Briefcase, Check, X, Loader2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { 
    getMyApplicationsAction, 
    getIncomingApplicationsAction,
    acceptApplicationAction,
    rejectApplicationAction 
} from "@/app/actions/applications";
import ApplicationReviewModal from "./ApplicationReviewModal";

interface ProjectApplicationsProps {
    initialUser: any;
    initialApplications?: {
        my: MyApplication[];
        incoming: IncomingApplication[];
    };
}

interface MyApplication {
    id: string;
    projectId: string;
    projectTitle: string;
    projectSlug?: string | null;
    projectCover?: string | null;
    roleTitle: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    canApply?: boolean;
    waitTime?: string;
}

interface IncomingApplication {
    id: string;
    projectId: string;
    projectTitle: string;
    projectSlug?: string | null;
    roleTitle: string;
    applicant: {
        id: string;
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
    };
    status: string;
    createdAt: Date;
}

export default function ProjectApplicationsSection({ initialUser, initialApplications }: ProjectApplicationsProps) {
    const hasInitialApplications = !!initialApplications;
    const [myApplications, setMyApplications] = useState<MyApplication[]>(initialApplications?.my || []);
    const [incomingApplications, setIncomingApplications] = useState<IncomingApplication[]>(initialApplications?.incoming || []);
    const [hasMoreIncoming, setHasMoreIncoming] = useState(initialApplications ? initialApplications.incoming.length >= 20 : false); // Optimistic guess
    const [isLoading, setIsLoading] = useState(!hasInitialApplications);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [expandMy, setExpandMy] = useState(true);
    const [expandIncoming, setExpandIncoming] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Modal State
    const [reviewModalState, setReviewModalState] = useState<{
        isOpen: boolean;
        applicationId: string | null;
        mode: "accept" | "reject";
        applicantName: string;
        roleTitle: string;
    }>({
        isOpen: false,
        applicationId: null,
        mode: "accept",
        applicantName: "",
        roleTitle: ""
    });

    // OPTIMIZATION: Fetch both in parallel, let backend filter appropriately
    useEffect(() => {
        if (!initialUser?.id) return;

        let cancelled = false;

        // Keep server-provided data visible while refreshing in background.
        if (!hasInitialApplications) {
            setIsLoading(true);
        } else {
            setIsLoading(false);
        }

        async function fetchApplications() {
            try {
                // Parallel fetch - both actions are lightweight and indexed
                const [myRes, incomingRes] = await Promise.all([
                    getMyApplicationsAction(),
                    getIncomingApplicationsAction(20, 0)
                ]);
                
                if (!cancelled) {
                    setMyApplications(myRes.applications || []);
                    setIncomingApplications(incomingRes.applications || []);
                    setHasMoreIncoming(!!incomingRes.hasMore);
                }
            } catch (error) {
                console.error("Failed to fetch applications:", error);
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        fetchApplications();
        
        return () => {
            cancelled = true;
        };
    }, [initialUser?.id, hasInitialApplications]);

    const handleLoadMore = async () => {
        if (isLoadingMore || !hasMoreIncoming) return;
        setIsLoadingMore(true);
        try {
            const result = await getIncomingApplicationsAction(20, incomingApplications.length);
            if (result.success) {
                setIncomingApplications(prev => [...prev, ...result.applications]);
                setHasMoreIncoming(!!result.hasMore);
            }
        } catch (error) {
            toast.error("Failed to load more applications");
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleAccept = useCallback((app: IncomingApplication) => {
        setReviewModalState({
            isOpen: true,
            applicationId: app.id,
            mode: "accept",
            applicantName: app.applicant.fullName || app.applicant.username || "User",
            roleTitle: app.roleTitle
        });
    }, []);

    const handleReject = useCallback((app: IncomingApplication) => {
        setReviewModalState({
            isOpen: true,
            applicationId: app.id,
            mode: "reject",
            applicantName: app.applicant.fullName || app.applicant.username || "User",
            roleTitle: app.roleTitle
        });
    }, []);

    const handleConfirmReview = async (message: string, reason?: string) => {
        const { applicationId, mode } = reviewModalState;
        if (!applicationId) return;

        setProcessingId(applicationId); // Optimistic UI for list item
        try {
            let result;
            if (mode === "accept") {
                result = await acceptApplicationAction(applicationId, message);
            } else {
                result = await rejectApplicationAction(applicationId, message, reason);
            }

            if (result.success) {
                toast.success(mode === "accept" ? "Application accepted!" : "Application rejected");
                setIncomingApplications(prev => prev.filter(a => a.id !== applicationId));
            } else {
                toast.error(result.error || `Failed to ${mode}`);
            }
        } catch (error) {
            toast.error("Something went wrong");
        } finally {
            setProcessingId(null);
        }
    };

    if (!initialUser) return null;
    if (isLoading) {
        return (
            <div className="mb-8">
                <div className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                    <Briefcase className="w-5 h-5 text-purple-500" />
                    Project Applications
                </div>
                <div className="animate-pulse space-y-3">
                    <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
                    <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
                </div>
            </div>
        );
    }

    const hasAny = myApplications.length > 0 || incomingApplications.length > 0;
    if (!hasAny) return null;

    return (
        <div className="mb-8">
            <div className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                <Briefcase className="w-5 h-5 text-purple-500" />
                Project Applications
            </div>

            {/* Incoming Applications (for creators) */}
            {incomingApplications.length > 0 && (
                <div className="mb-6">
                    <button 
                        onClick={() => setExpandIncoming(!expandIncoming)}
                        className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                        {expandIncoming ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        Pending Review
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            {incomingApplications.length}
                        </span>
                    </button>

                    {expandIncoming && (
                        <div className="space-y-3">
                            {incomingApplications.map(app => (
                                <div 
                                    key={app.id}
                                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                                >
                                    <div className="flex items-start gap-3">
                                        <Link href={`/u/${app.applicant.username || app.applicant.id}`} className="flex-shrink-0">
                                            {app.applicant.avatarUrl ? (
                                                <Image
                                                    src={app.applicant.avatarUrl}
                                                    alt={app.applicant.fullName || "User"}
                                                    width={48}
                                                    height={48}
                                                    className="w-12 h-12 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white font-semibold">
                                                    {(app.applicant.fullName || app.applicant.username || "U")[0]?.toUpperCase()}
                                                </div>
                                            )}
                                        </Link>
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                href={`/u/${app.applicant.username || app.applicant.id}`}
                                                className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-purple-600 dark:hover:text-purple-400 block truncate"
                                            >
                                                {app.applicant.fullName || app.applicant.username || "User"}
                                            </Link>
                                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                                Applied for <span className="font-medium text-purple-600 dark:text-purple-400">{app.roleTitle}</span>
                                            </p>
                                            <p className="text-xs text-zinc-400 mt-1">
                                                in <Link href={`/projects/${app.projectSlug || app.projectId}`} className="hover:underline">{app.projectTitle}</Link>
                                                {" • "}
                                                {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 mt-4">
                                        <button
                                            onClick={() => handleAccept(app)}
                                            disabled={processingId === app.id}
                                            className="flex-1 px-3 py-2 text-sm font-bold rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                            Accept
                                        </button>
                                        <button
                                            onClick={() => handleReject(app)}
                                            disabled={processingId === app.id}
                                            className="px-3 py-2 text-sm font-semibold rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {hasMoreIncoming && (
                                <button
                                    onClick={handleLoadMore}
                                    disabled={isLoadingMore}
                                    className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Load More Applications
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* My Applications */}
            {myApplications.length > 0 && (
                <div>
                    <button 
                        onClick={() => setExpandMy(!expandMy)}
                        className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                        {expandMy ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        My Applications
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            {myApplications.length}
                        </span>
                    </button>

                    {expandMy && (
                        <div className="space-y-3">
                            {myApplications.map(app => {
                                const statusStyle = {
                                    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                    accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                                    rejected: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                }[app.status] || "";

                                return (
                                    <div 
                                        key={app.id}
                                        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                                                <Briefcase className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <Link
                                                    href={`/projects/${app.projectSlug || app.projectId}`}
                                                    className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-purple-600 dark:hover:text-purple-400 block truncate"
                                                >
                                                    {app.projectTitle}
                                                </Link>
                                                <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                                                    {app.roleTitle}
                                                </p>
                                            </div>
                                            <div className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full ${statusStyle}`}>
                                                {app.status === "pending" && <Clock className="w-3 h-3 inline mr-1" />}
                                                {app.status}
                                            </div>
                                        </div>
                                        {app.status === "rejected" && app.waitTime && !app.canApply && (
                                            <p className="text-xs text-zinc-500 mt-2">
                                                ⏳ You can reapply in {app.waitTime}
                                            </p>
                                        )}
                                        <p className="text-xs text-zinc-400 mt-2">
                                            Applied {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <ApplicationReviewModal
                isOpen={reviewModalState.isOpen}
                onClose={() => setReviewModalState(prev => ({ ...prev, isOpen: false }))}
                onConfirm={handleConfirmReview}
                mode={reviewModalState.mode}
                applicantName={reviewModalState.applicantName}
                roleTitle={reviewModalState.roleTitle}
            />
        </div>
    );
}
