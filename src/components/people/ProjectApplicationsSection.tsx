"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import Link from "next/link";
import Image from "next/image";
import {
    Briefcase, Check, X, Loader2, Clock, ChevronDown, ChevronRight,
    ArrowUpRight, ArrowDownLeft, MessageSquare, Pencil, ExternalLink,
    CheckCircle2, Ban, FolderOpen,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { getAvatarGradient } from "@/lib/ui/avatar";
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
    canEditUntil?: string | null;
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

// ── Status configuration ────────────────────────────────────────────

import { getLifecycleStatusStyle } from "@/lib/ui/status-config";

const APP_STATUS_ICONS: Record<string, typeof Clock> = {
    pending: Clock,
    accepted: CheckCircle2,
    rejected: X,
    withdrawn: Ban,
    role_filled: CheckCircle2,
};

// ── Avatar ──────────────────────────────────────────────────────────

function AppAvatar({
    src,
    name,
    type,
    size = 36,
}: {
    src?: string | null;
    name: string;
    type: "user" | "project";
    size?: number;
}) {
    const sizeClass = size <= 32 ? "w-8 h-8" : size <= 36 ? "w-9 h-9" : "w-10 h-10";
    const textSize = size <= 32 ? "text-xs" : "text-sm";

    if (src) {
        return (
            <Image
                src={src}
                alt={name}
                width={size}
                height={size}
                className={cn(sizeClass, type === "user" ? "rounded-full" : "rounded-lg", "object-cover flex-shrink-0")}
            />
        );
    }

    const initial = (name || "U")[0]?.toUpperCase();
    const gradient = getAvatarGradient(name);

    return (
        <div className={cn(
            sizeClass,
            type === "user" ? "rounded-full" : "rounded-lg",
            "flex-shrink-0 flex items-center justify-center bg-gradient-to-br text-white font-semibold",
            textSize,
            gradient,
        )}>
            {type === "project" ? <Briefcase className="w-4 h-4" /> : initial}
        </div>
    );
}

// ── Sub-section toggle ──────────────────────────────────────────────

function SubSectionHeader({
    title,
    count,
    open,
    onToggle,
}: {
    title: string;
    count: number;
    open: boolean;
    onToggle: () => void;
}) {
    const panelId = `${title.toLowerCase().replace(/\s+/g, '-')}-panel`;
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="w-full flex items-center gap-2 mb-3 group"
        >
            {open ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            )}
            <span className="text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                {title}
            </span>
            <span className="text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded-full">
                {count}
            </span>
            <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800 ml-1" />
        </button>
    );
}

// ── Incoming application row ────────────────────────────────────────

function IncomingApplicationRow({
    app,
    isProcessing,
    onAccept,
    onReject,
}: {
    app: IncomingApplication;
    isProcessing: boolean;
    onAccept: () => void;
    onReject: () => void;
}) {
    const applicantName = app.applicant.fullName || app.applicant.username || "User";

    return (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl group">
            {/* Avatar with direction indicator */}
            <div className="relative flex-shrink-0">
                <Link href={`/u/${app.applicant.username || app.applicant.id}`}>
                    <AppAvatar
                        src={app.applicant.avatarUrl}
                        name={applicantName}
                        type="user"
                        size={40}
                    />
                </Link>
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-900 bg-primary flex items-center justify-center">
                    <ArrowDownLeft className="w-2 h-2 text-white" />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                        href={`/u/${app.applicant.username || app.applicant.id}`}
                        className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-primary dark:hover:text-primary transition-colors truncate"
                    >
                        {applicantName}
                    </Link>
                    <span className="text-xs text-zinc-400">applied for</span>
                    <span className="text-xs font-medium text-primary truncate">{app.roleTitle}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    <Link
                        href={`/projects/${app.projectSlug || app.projectId}`}
                        className="hover:text-primary transition-colors truncate"
                    >
                        {app.projectTitle}
                    </Link>
                    <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-700 flex-shrink-0" />
                    <span className="flex-shrink-0">{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}</span>
                </div>
            </div>

            {/* Actions — always visible */}
            <div className="flex items-center gap-2 flex-shrink-0">
                <button
                    type="button"
                    onClick={onAccept}
                    disabled={isProcessing}
                    className="px-3.5 py-1.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    aria-label={`Accept application from ${applicantName}`}
                >
                    {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Accept
                </button>
                <button
                    type="button"
                    onClick={onReject}
                    disabled={isProcessing}
                    className="px-3.5 py-1.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    aria-label={`Reject application from ${applicantName}`}
                >
                    {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    Reject
                </button>
            </div>
        </div>
    );
}

// ── My application row ──────────────────────────────────────────────

function MyApplicationRow({
    app,
    isProcessing,
    onEdit,
}: {
    app: MyApplication;
    isProcessing: boolean;
    onEdit: () => void;
}) {
    const lifecycle = app.lifecycleStatus || app.status;
    const config = getLifecycleStatusStyle(lifecycle);
    const StatusIcon = APP_STATUS_ICONS[lifecycle] || Clock;
    const reasonLabel = getApplicationDecisionReasonLabel(app.decisionReason);

    return (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
            {/* Avatar with status dot */}
            <div className="relative flex-shrink-0">
                <AppAvatar
                    src={app.projectCover}
                    name={app.projectTitle}
                    type="project"
                    size={40}
                />
                <div className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-900",
                    config.dotColor,
                )} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                        href={`/projects/${app.projectSlug || app.projectId}`}
                        className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-primary dark:hover:text-primary transition-colors truncate"
                    >
                        {app.projectTitle}
                    </Link>
                    <ArrowUpRight className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium flex-shrink-0", config.textColor)}>
                        <StatusIcon className="w-3 h-3" />
                        {config.label}
                    </span>
                </div>

                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                    {app.roleTitle}
                    {reasonLabel && <span className="text-zinc-400 dark:text-zinc-500"> &middot; {reasonLabel}</span>}
                </p>

                <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    <span>Applied {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}</span>
                    {app.decisionAt && (
                        <>
                            <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-700" />
                            <span>Updated {formatDistanceToNow(new Date(app.decisionAt), { addSuffix: true })}</span>
                        </>
                    )}
                    {lifecycle === "rejected" && app.waitTime && !app.canApply && (
                        <>
                            <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-700" />
                            <span>Reapply in {app.waitTime}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {lifecycle === "pending" && (
                    <button
                        type="button"
                        onClick={onEdit}
                        disabled={!app.canEdit || isProcessing}
                        className="p-2 rounded-xl text-zinc-400 hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={app.canEdit ? "Edit application" : "Edit window closed"}
                        aria-label="Edit application"
                    >
                        <Pencil className="w-4 h-4" />
                    </button>
                )}
                {app.conversationId && (
                    <Link
                        href={`/messages?conversationId=${app.conversationId}&applicationId=${app.id}`}
                        className="p-2 rounded-xl text-zinc-400 hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Open chat"
                        aria-label="Open application chat"
                    >
                        <MessageSquare className="w-4 h-4" />
                    </Link>
                )}
                <Link
                    href={`/projects/${app.projectSlug || app.projectId}`}
                    className="p-2 rounded-xl text-zinc-400 hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    title="View project"
                    aria-label="View project"
                >
                    <ExternalLink className="w-4 h-4" />
                </Link>
            </div>
        </div>
    );
}

// ── Main component ──────────────────────────────────────────────────

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
        roleTitle: "",
    });

    // ── Data fetching ───────────────────────────────────────────────

    useEffect(() => {
        if (!initialUser?.id) return;

        let cancelled = false;

        // 5J: Skip fetch if initial data was provided
        if (hasInitialApplications) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        async function fetchApplications() {
            try {
                const [myRes, incomingRes] = await Promise.all([
                    getMyApplicationsAction({ limit: 20 }),
                    getIncomingApplicationsAction({ limit: 20 }),
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

    // ── Pagination ──────────────────────────────────────────────────

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

    // ── Review handlers ─────────────────────────────────────────────

    const handleAccept = useCallback((app: IncomingApplication) => {
        setReviewModalState({
            isOpen: true,
            applicationId: app.id,
            projectId: app.projectId,
            mode: "accept",
            applicantName: app.applicant.fullName || app.applicant.username || "User",
            roleTitle: app.roleTitle,
        });
    }, []);

    const handleReject = useCallback((app: IncomingApplication) => {
        setReviewModalState({
            isOpen: true,
            applicationId: app.id,
            projectId: app.projectId,
            mode: "reject",
            applicantName: app.applicant.fullName || app.applicant.username || "User",
            roleTitle: app.roleTitle,
        });
    }, []);

    const handleConfirmReview = async (message: string, reason?: string) => {
        const { applicationId, projectId, mode } = reviewModalState;
        if (!applicationId) return;

        const startedAt = performance.now();
        const requestId = `application-decision:${applicationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        setProcessingId(applicationId);
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

    // ── Edit handlers ───────────────────────────────────────────────

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
                        ? (() => {
                            const fallbackCanEdit =
                                Date.now() - new Date(application.createdAt).getTime() <= APPLICATION_EDIT_WINDOW_MS;
                            let canEdit = fallbackCanEdit;

                            if (application.canEditUntil) {
                                const editDeadline = Date.parse(application.canEditUntil);
                                if (Number.isFinite(editDeadline)) {
                                    canEdit = Date.now() < editDeadline;
                                } else {
                                    logger.warn("Invalid application edit deadline", {
                                        module: "applications",
                                        applicationId: application.id,
                                        canEditUntil: application.canEditUntil,
                                    });
                                }
                            }

                            return {
                                ...application,
                                message: nextMessage,
                                updatedAt: new Date(),
                                canEdit,
                            };
                        })()
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

    // ── Render ──────────────────────────────────────────────────────

    if (!initialUser) return null;

    if (isLoading) {
        return (
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-6">
                <div className="space-y-4 animate-pulse">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex gap-3">
                            <div className="w-10 h-10 rounded-lg bg-zinc-200/60 dark:bg-zinc-800 flex-shrink-0" />
                            <div className="flex-1 space-y-2 pt-1">
                                <div className="h-3.5 w-48 bg-zinc-200/60 dark:bg-zinc-800 rounded" />
                                <div className="h-3 w-64 bg-zinc-200/60 dark:bg-zinc-800 rounded" />
                                <div className="h-2.5 w-24 bg-zinc-200/60 dark:bg-zinc-800 rounded" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const hasAny = myApplications.length > 0 || incomingApplications.length > 0;

    if (!hasAny) {
        return (
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl px-6 py-12 text-center">
                <FolderOpen className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No applications</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                    Project applications you send or receive will appear here
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* ── Incoming Applications (for project owners) ── */}
            {incomingApplications.length > 0 && (
                <div>
                    <SubSectionHeader
                        title="Pending Review"
                        count={incomingApplications.length}
                        open={expandIncoming}
                        onToggle={() => setExpandIncoming(!expandIncoming)}
                    />

                    {expandIncoming && (
                        <div id="pending-review-panel" role="region" className="space-y-3">
                            {incomingApplications.map((app) => (
                                <IncomingApplicationRow
                                    key={app.id}
                                    app={app}
                                    isProcessing={processingId === app.id}
                                    onAccept={() => handleAccept(app)}
                                    onReject={() => handleReject(app)}
                                />
                            ))}
                            {hasMoreIncoming && (
                                <button
                                    type="button"
                                    onClick={handleLoadMore}
                                    disabled={isLoadingMore}
                                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors flex items-center justify-center gap-2"
                                >
                                    {isLoadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    Load more applications
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── My Applications ── */}
            {myApplications.length > 0 && (
                <div>
                    <SubSectionHeader
                        title="My Applications"
                        count={myApplications.length}
                        open={expandMy}
                        onToggle={() => setExpandMy(!expandMy)}
                    />

                    {expandMy && (
                        <div id="my-applications-panel" role="region" className="space-y-3">
                            {myApplications.map((app) => (
                                <MyApplicationRow
                                    key={app.id}
                                    app={app}
                                    isProcessing={processingId === app.id}
                                    onEdit={() => openEditModal(app)}
                                />
                            ))}
                            {hasMoreMy && (
                                <button
                                    type="button"
                                    onClick={handleLoadMoreMy}
                                    disabled={isLoadingMoreMy}
                                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors flex items-center justify-center gap-2"
                                >
                                    {isLoadingMoreMy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    Load more applications
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Review Modal ── */}
            <ApplicationReviewModal
                isOpen={reviewModalState.isOpen}
                onClose={() => setReviewModalState(prev => ({ ...prev, isOpen: false }))}
                onConfirm={handleConfirmReview}
                mode={reviewModalState.mode}
                applicantName={reviewModalState.applicantName}
                roleTitle={reviewModalState.roleTitle}
            />

            {/* ── Edit Modal ── */}
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
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-primary dark:focus:ring-primary/20"
                        placeholder="Write your updated application message..."
                        disabled={isSavingEdit}
                    />
                    <div className="text-right text-xs text-zinc-400 dark:text-zinc-500">
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
