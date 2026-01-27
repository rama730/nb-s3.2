"use client";

import React, { useMemo, memo } from "react";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
    ProjectOverviewCard,
    TeamCard,
    OpenRolesCard,
    ProjectPulseCard,
} from "@/components/projects/dashboard";
import { TabErrorBoundary } from "@/components/projects/TabErrorBoundary";

const DASH_STATUS_META = {
    todo: {
        label: "To do",
        className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
    },
    in_progress: {
        label: "In progress",
        className: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    },
    done: {
        label: "Done",
        className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    },
} as const;

const DASH_PRIORITY_META: Record<string, { label: string; className: string }> = {
    urgent: {
        label: "Urgent",
        className: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-800",
    },
    high: {
        label: "High",
        className: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    },
    medium: {
        label: "Medium",
        className: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    },
    low: {
        label: "Low",
        className: "bg-zinc-50 text-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800",
    },
};

interface DashboardTabProps {
    project: any;
    isCreator: boolean;
    isOwnerOrMember: boolean;
    isCollaborator: boolean;
    currentUserId: string | null;
    tasks: any[];
    dashboardTasks: any[] | null;
    files: any[];
    members: any[];
    rolesWithFilled: any[];
    projectActivityEvents: any[];
    followersCount: number;
    bookmarkCount: number;
    bookmarked: boolean;
    bookmarkLoading: boolean;
    shareCopied: boolean;
    onEdit: (tab?: string) => void;
    onShare: () => void;
    onBookmark: () => void;
    onFinalize: () => void;
    onAdvanceStage: () => void;
    onApplyToRole: (role: any) => void;
    onManageTeam: () => void;
    onViewBoard: () => void;
    onUploadFile: () => void;
    onViewAnalytics: () => void;
    onViewSprints: () => void;
    onViewSettings: () => void;
    onTaskClick: (taskId: string) => void;
    lifecycleStages: any[];
}

export function DashboardTab({
    project,
    isCreator,
    isOwnerOrMember,
    isCollaborator,
    currentUserId,
    tasks,
    dashboardTasks,
    members,
    rolesWithFilled,
    followersCount,
    bookmarkCount,
    bookmarked,
    bookmarkLoading,
    shareCopied,
    onEdit,
    onShare,
    onBookmark,
    onFinalize,
    onAdvanceStage,
    onApplyToRole,
    onManageTeam,
    onViewBoard,
    onViewSprints,
    onTaskClick,
    lifecycleStages,
}: DashboardTabProps) {
    const tasksForPulse = dashboardTasks ?? tasks;
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

    const myFocus = useMemo(() => {
        if (!currentUserId) return [];
        const list = (tasks || []).filter((t: any) => t?.status !== "done" && t?.assigned_to === currentUserId);
        return list.sort((a: any, b: any) => {
            const pa = priorityRank[a?.priority] ?? 9;
            const pb = priorityRank[b?.priority] ?? 9;
            if (pa !== pb) return pa - pb;
            const da = a?.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
            const db = b?.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
            return da - db;
        }).slice(0, 6);
    }, [tasks, currentUserId]);

    const needsOwner = useMemo(() => {
        const list = (tasks || []).filter((t: any) => t?.status !== "done" && !t?.assigned_to);
        return list.sort((a: any, b: any) => {
            const pa = priorityRank[a?.priority] ?? 9;
            const pb = priorityRank[b?.priority] ?? 9;
            return pa - pb;
        }).slice(0, 6);
    }, [tasks]);

    const overdue = useMemo(() => {
        const now = Date.now();
        const list = (tasks || []).filter((t: any) => {
            if (t?.status === "done") return false;
            if (!t?.due_date) return false;
            return new Date(t.due_date).getTime() < now;
        });
        return list.sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()).slice(0, 6);
    }, [tasks]);

    const pulseActivities = useMemo(() => [], []);

    const totalOpenPositions = useMemo(() => {
        return (rolesWithFilled || []).reduce((sum: number, role: any) => {
            const remaining = (role?.count || 0) - (role?.filled || 0);
            return sum + Math.max(0, remaining);
        }, 0);
    }, [rolesWithFilled]);

    const pulseCard = (
        <TabErrorBoundary tabName="Dashboard">
            <Suspense fallback={<CardSkeleton />}>
                <ProjectPulseCard
                    projectId={project.id}
                    activities={pulseActivities}
                    tasks={tasksForPulse || []}
                    isCollaborator={isOwnerOrMember}
                    isCreator={isCreator}
                    currentUserId={currentUserId}
                    onViewBoard={onViewBoard}
                    onUploadFile={() => { }}
                    onViewAnalytics={() => { }}
                    onViewSprints={onViewSprints}
                    onViewSettings={() => { }}
                    onTaskClick={onTaskClick}
                />
            </Suspense>
        </TabErrorBoundary>
    );

    const teamAndRoles = (
        <>
            <TabErrorBoundary tabName="Team">
                <Suspense fallback={<CardSkeleton />}>
                    <TeamCard
                        project={project}
                        members={members}
                        openRoles={rolesWithFilled}
                        isCreator={isCreator}
                        onManageTeam={onManageTeam}
                        onInvite={onManageTeam}
                    />
                </Suspense>
            </TabErrorBoundary>
            {totalOpenPositions > 0 && (
                <OpenRolesCard
                    roles={rolesWithFilled}
                    isCreator={isCreator}
                    isCollaborator={isCollaborator}
                    hasPendingApplication={false}
                    onApply={onApplyToRole}
                    onManageRoles={() => onEdit("roles")}
                />
            )}
        </>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
                <ProjectOverviewCard
                    project={project}
                    isCreator={isCreator}
                    bookmarked={bookmarked}
                    bookmarkCount={bookmarkCount}
                    followersCount={followersCount}
                    membersCount={members.length + 1}
                    hideActionBar={true}
                    onEdit={() => onEdit("essentials")}
                    onShare={onShare}
                    onBookmark={onBookmark}
                    onFinalize={onFinalize}
                    shareCopied={shareCopied}
                    bookmarkLoading={bookmarkLoading}
                    lifecycleStages={lifecycleStages}
                    currentStageIndex={project.current_stage_index || 0}
                    onAdvanceStage={onAdvanceStage}
                />


            </div>

            <div className="lg:col-span-5 space-y-6">
                {pulseCard}
                {teamAndRoles}
            </div>
        </div>
    );
}



// CardSkeleton - memoized 
const CardSkeleton = memo(function CardSkeleton() {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
            <div className="flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-md" />
                <Skeleton className="w-32 h-5" />
            </div>
            <div className="space-y-3 pt-4">
                <Skeleton className="w-full h-12 rounded-xl" />
                <Skeleton className="w-full h-12 rounded-xl" />
                <Skeleton className="w-full h-12 rounded-xl" />
            </div>
        </div>
    );
});

export default DashboardTab;
