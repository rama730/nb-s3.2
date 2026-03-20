"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import Link from "next/link";
import Image from "next/image";
import { Briefcase, Check, X, Loader2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { 
    getMyApplicationsAction, 
    getIncomingApplicationsAction,
    acceptApplicationAction,
    rejectApplicationAction,
    editPendingApplicationAction,
} from "@/app/actions/applications";
import ApplicationReviewModal from "./ApplicationReviewModal";
import { PROJECT_MEMBERS_QUERY_KEY } from "@/hooks/hub/useProjectData";
import { getApplicationDecisionReasonLabel } from "@/lib/applications/reasons";
import { logger } from "@/lib/logger";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const APPLICATION_EDIT_WINDOW_MS = 10 * 60 * 1000;

interface ProjectApplicationsProps {
    initialUser: { id?: string | null } | null;
    initialApplications?: {
        my: MyApplication[];
        incoming: IncomingApplication[];
    };
}

export interface MyApplication {
    id: string;
    projectId: string;
    projectTitle: string;
    projectSlug?: string | null;
    projectCover?: string | null;
    roleTitle: string;
    message?: string | null;
    status: string;
    lifecycleStatus?: "pending" | "accepted" | "rejected" | "withdrawn" | "role_filled";
    decisionReason?: string | null;
    decisionAt?: string | null;
    conversationId?: string | null;
    createdAt: Date;
    updatedAt: Date;
    canEdit?: boolean;
    canApply?: boolean;
    waitTime?: string;
}

export interface IncomingApplication {
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
    const queryClient = useQueryClient();
    const hasInitialApplications = !!initialApplications;
    const [myApplications, setMyApplications] = useState<MyApplication[]>(initialApplications?.my || []);
    const [incomingApplications, setIncomingApplications] = useState<IncomingApplication[]>(initialApplications?.incoming || []);
    const [hasMoreIncoming, setHasMoreIncoming] = useState(false);
    const [incomingNextCursor, setIncomingNextCursor] = useState<string | null>(null);
    const [hasMoreMy, setHasMoreMy] = useState(false);
    const [myNextCursor, setMyNextCursor] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(!hasInitialApplications);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isLoadingMoreMy, setIsLoadingMoreMy] = useState(false);
    const [expandMy, setExpandMy] = useState(true);
    const [expandIncoming, setExpandIncoming] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [editModalState, setEditModalState] = useState<{
        isOpen: boolean;
        applicationId: string | null;
        projectId: string | null;
        draft: string;
    }>({
        isOpen: false,
        applicationId: null,
        projectId: null,
        draft: "",
    });

    // Modal State
    const [reviewModalState, setReviewModalState] = useState<{
        isOpen: boolean;
        applicationId: string | null;
        projectId: string | null;
        mode: "accept" | "reject";
        applicantName: string;
        roleTitle: string;
    }>({
        isOpen: false,
        applicationId: null,
        projectId: null,
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
                    getMyApplicationsAction({ limit: 20 }),
                    getIncomingApplicationsAction({ limit: 20 })
                ]);
                
                if (!cancelled) {
                    setMyApplications(myRes.applications || []);
                    setHasMoreMy(!!myRes.hasMore);
                    setMyNextCursor(myRes.nextCursor || null);
                    setIncomingApplications(incomingRes.applications || []);
                    setHasMoreIncoming(!!incomingRes.hasMore);
                    setIncomingNextCursor(incomingRes.nextCursor || null);
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

    useEffect(() => {
        if (!initialUser?.id) return;
        let cancelled = false;

        const refresh = async () => {
            try {
                const [myRes, incomingRes] = await Promise.all([
                    getMyApplicationsAction({ limit: 20 }),
                    getIncomingApplicationsAction({ limit: 20 }),
                ]);
                if (cancelled) return;
                setMyApplications(myRes.applications || []);
                setHasMoreMy(!!myRes.hasMore);
                setMyNextCursor(myRes.nextCursor || null);
                setIncomingApplications(incomingRes.applications || []);
                setHasMoreIncoming(!!incomingRes.hasMore);
                setIncomingNextCursor(incomingRes.nextCursor || null);
            } catch {
                // silent background refresh
            }
        };

        const cleanup = createVisibilityAwareInterval(refresh, 30000);
        return () => {
            cancelled = true;
            cleanup();
        };
    }, [initialUser?.id]);

    const handleLoadMore = async () => {
        if (isLoadingMore || !hasMoreIncoming || !incomingNextCursor) return;
        setIsLoadingMore(true);
        try {
            const result = await getIncomingApplicationsAction({ limit: 20, cursor: incomingNextCursor });
            if (result.success) {
                setIncomingApplications(prev => [...prev, ...(result.applications || [])]);
                setHasMoreIncoming(!!result.hasMore);
                setIncomingNextCursor(result.nextCursor || null);
            }
        } catch {
            toast.error("Failed to load more applications");
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleLoadMoreMy = async () => {
        if (isLoadingMoreMy || !hasMoreMy || !myNextCursor) return;
        setIsLoadingMoreMy(true);
        try {
            const result = await getMyApplicationsAction({ limit: 20, cursor: myNextCursor });
            if (result.success) {
                setMyApplications((prev) => [...prev, ...(result.applications || [])]);
                setHasMoreMy(!!result.hasMore);
                setMyNextCursor(result.nextCursor || null);
            } else {
                toast.error(result.error || "Failed to load applications");
            }
        } catch {
            toast.error("Failed to load applications");
        } finally {
            setIsLoadingMoreMy(false);
        }
    };

    const handleAccept = useCallback((app: IncomingApplication) => {
        setReviewModalState({
            isOpen: true,
            applicationId: app.id,
            projectId: app.projectId,
            mode: "accept",
            applicantName: app.applicant.fullName || app.applicant.username || "User",
            roleTitle: app.roleTitle
        });
    }, []);

    const handleReject = useCallback((app: IncomingApplication) => {
        setReviewModalState({
            isOpen: true,
            applicationId: app.id,
            projectId: app.projectId,
            mode: "reject",
            applicantName: app.applicant.fullName || app.applicant.username || "User",
            roleTitle: app.roleTitle
        });
    }, []);

    const handleConfirmReview = async (message: string, reason?: string) => {
        const { applicationId, projectId, mode } = reviewModalState;
        if (!applicationId) return;

        const startedAt = performance.now();
        const requestId = `application-decision:${applicationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        setProcessingId(applicationId); // Optimistic UI for list item
        try {
            let result;
            if (mode === "accept") {
                result = await acceptApplicationAction(applicationId, message);
            } else {
                result = await rejectApplicationAction(applicationId, message, reason);
            }

            if (result.success) {
                const durationMs = Math.round(performance.now() - startedAt);
                logger.metric("applications.review.result", {
                    module: "people-requests",
                    mode,
                    applicationId,
                    projectId: projectId || null,
                    applicationTraceId: result.applicationTraceId || null,
                    result: "success",
                    durationMs,
                    requestId,
                });
                logger.metric("project.detail.application.decision", {
                    interaction: "application.decision",
                    mode,
                    applicationId,
                    projectId: projectId || null,
                    applicationTraceId: result.applicationTraceId || null,
                    requestId,
                    durationMs,
                    result: "success",
                });
                toast.success(mode === "accept" ? "Application accepted!" : "Application rejected");
                setIncomingApplications(prev => prev.filter(a => a.id !== applicationId));

                if (projectId) {
                    await queryClient.invalidateQueries({
                        queryKey: PROJECT_MEMBERS_QUERY_KEY(projectId),
                        refetchType: "all",
                    });
                }
            } else {
                const durationMs = Math.round(performance.now() - startedAt);
                logger.metric("applications.review.result", {
                    module: "people-requests",
                    mode,
                    applicationId,
                    projectId: projectId || null,
                    applicationTraceId: result.applicationTraceId || null,
                    errorCode: result.errorCode || "UNKNOWN",
                    result: "failure",
                    durationMs,
                    requestId,
                });
                logger.metric("project.detail.application.decision", {
                    interaction: "application.decision",
                    mode,
                    applicationId,
                    projectId: projectId || null,
                    applicationTraceId: result.applicationTraceId || null,
                    requestId,
                    durationMs,
                    result: "failure",
                    errorCode: result.errorCode || "UNKNOWN",
                });
                toast.error(result.error || `Failed to ${mode}`);
            }
        } catch (error) {
            const durationMs = Math.round(performance.now() - startedAt);
            logger.metric("project.detail.application.decision", {
                interaction: "application.decision",
                mode,
                applicationId,
                projectId: projectId || null,
                requestId,
                durationMs,
                result: "failure",
                errorCode: "UNEXPECTED_ERROR",
                message: error instanceof Error ? error.message : "Unknown error",
            });
            toast.error("Something went wrong");
        } finally {
            setProcessingId(null);
        }
    };

    const openEditModal = useCallback((application: MyApplication) => {
        setEditModalState({
            isOpen: true,
            applicationId: application.id,
            projectId: application.projectId,
            draft: application.message || "",
        });
    }, []);

    const closeEditModal = useCallback(() => {
        if (isSavingEdit) return;
        setEditModalState({
            isOpen: false,
            applicationId: null,
            projectId: null,
            draft: "",
        });
    }, [isSavingEdit]);

    const handleSubmitEdit = useCallback(async () => {
        if (!editModalState.applicationId) return;
        const nextMessage = editModalState.draft.trim();
        if (!nextMessage) {
            toast.error("Application message cannot be empty");
            return;
        }

        setIsSavingEdit(true);
        try {
            const result = await editPendingApplicationAction(editModalState.applicationId, nextMessage);
            if (!result.success) {
                toast.error(result.error || "Failed to update application");
                return;
            }

            setMyApplications((previous) =>
                previous.map((application) =>
                    application.id === editModalState.applicationId
                        ? {
                            ...application,
                            message: nextMessage,
                            updatedAt: new Date(),
                            canEdit:
                                Date.now() - new Date(application.createdAt).getTime() <= APPLICATION_EDIT_WINDOW_MS,
                        }
                        : application
                )
            );

            toast.success("Application updated");
            if (editModalState.projectId) {
                await queryClient.invalidateQueries({
                    queryKey: PROJECT_MEMBERS_QUERY_KEY(editModalState.projectId),
                    refetchType: "all",
                });
            }
            closeEditModal();
        } catch {
            toast.error("Failed to update application");
        } finally {
            setIsSavingEdit(false);
        }
    }, [closeEditModal, editModalState.applicationId, editModalState.draft, editModalState.projectId, queryClient]);

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
                <Briefcase className="w-5 h-5 text-primary" />
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
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary">
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
                                                <div className="w-12 h-12 rounded-full app-accent-gradient flex items-center justify-center text-white font-semibold">
                                                    {(app.applicant.fullName || app.applicant.username || "U")[0]?.toUpperCase()}
                                                </div>
                                            )}
                                        </Link>
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                href={`/u/${app.applicant.username || app.applicant.id}`}
                                                className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-primary block truncate"
                                            >
                                                {app.applicant.fullName || app.applicant.username || "User"}
                                            </Link>
                                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                                Applied for <span className="font-medium text-primary">{app.roleTitle}</span>
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
                                            className="flex-1 px-3 py-2 text-sm font-bold rounded-xl app-accent-solid hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
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
                                const lifecycle = app.lifecycleStatus || app.status;
                                const statusStyle = {
                                    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                    accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                                    rejected: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                                    withdrawn: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                                    role_filled: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                                }[lifecycle] || "";
                                const statusLabel = lifecycle === "role_filled" ? "filled" : lifecycle;
                                const reasonLabel = getApplicationDecisionReasonLabel(app.decisionReason);

                                return (
                                    <div 
                                        key={app.id}
                                        id={`app-${app.id}`}
                                        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                <Briefcase className="w-5 h-5 text-primary" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <Link
                                                    href={`/projects/${app.projectSlug || app.projectId}`}
                                                    className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-primary block truncate"
                                                >
                                                    {app.projectTitle}
                                                </Link>
                                                <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                                                    {app.roleTitle}
                                                </p>
                                            </div>
                                            <div className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full ${statusStyle}`}>
                                                {lifecycle === "pending" && <Clock className="w-3 h-3 inline mr-1" />}
                                                {statusLabel}
                                            </div>
                                        </div>
                                        {reasonLabel && (
                                            <p className="text-xs mt-2 text-zinc-500 dark:text-zinc-400">
                                                {reasonLabel}
                                            </p>
                                        )}
                                        {app.status === "rejected" && app.waitTime && !app.canApply && (
                                            <p className="text-xs text-zinc-500 mt-2">
                                                ⏳ You can reapply in {app.waitTime}
                                            </p>
                                        )}
                                        {lifecycle === "pending" && (
                                            <div className="mt-3 flex items-center justify-between gap-2">
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    {app.canEdit ? "You can edit this application for up to 10 minutes." : "Edit window closed."}
                                                </p>
                                                <button
                                                    onClick={() => openEditModal(app)}
                                                    disabled={!app.canEdit || processingId === app.id}
                                                    className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        )}
                                        <p className="text-xs text-zinc-400 mt-2">
                                            Applied {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                            {app.decisionAt ? ` • Updated ${formatDistanceToNow(new Date(app.decisionAt), { addSuffix: true })}` : ""}
                                        </p>
                                        <div className="mt-2 flex items-center justify-end">
                                            {app.conversationId ? (
                                                <Link
                                                    href={`/messages?conversationId=${app.conversationId}&applicationId=${app.id}`}
                                                    className="text-xs font-medium text-primary hover:opacity-80"
                                                >
                                                    Open chat
                                                </Link>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                            {hasMoreMy && (
                                <button
                                    onClick={handleLoadMoreMy}
                                    disabled={isLoadingMoreMy}
                                    className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    {isLoadingMoreMy && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Load More Applications
                                </button>
                            )}
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

            <Dialog open={editModalState.isOpen} onOpenChange={(open) => !open && closeEditModal()}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Application</DialogTitle>
                        <DialogDescription>
                            Update your message. This update is mirrored to your chat thread.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={editModalState.draft}
                        onChange={(event) =>
                            setEditModalState((previous) => ({ ...previous, draft: event.target.value.slice(0, 2000) }))
                        }
                        rows={8}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
                        placeholder="Write your updated application message..."
                        disabled={isSavingEdit}
                    />
                    <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                        {editModalState.draft.length}/2000
                    </div>
                    <DialogFooter>
                        <Button variant="outline" type="button" onClick={closeEditModal} disabled={isSavingEdit}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSubmitEdit}
                            disabled={isSavingEdit || !editModalState.draft.trim()}
                        >
                            {isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
