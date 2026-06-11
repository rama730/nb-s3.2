"use client";

import React, { useMemo, memo } from "react";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
    ProjectOverviewCard,
    TeamCard,
    OpenRolesCard,
} from "@/components/projects/dashboard";
import { TabErrorBoundary } from "@/components/projects/TabErrorBoundary";

import { type ApplicationStatusResult } from "@/app/actions/applications";

interface DashboardTabProps {
    project: any;
    isCreator: boolean;
    isCollaborator: boolean;
    members: any[];
    rolesWithFilled: any[];
    onEdit: (tab?: string) => void;
    onShare: () => void;
    onAdvanceStage: () => void;
    onRedoStage?: () => void;
    onApplyToRole: (role: any) => void;
    onManageTeam: () => void;
    lifecycleStages: any[];
    currentStageIndex: number;
    hasNextMembers?: boolean;
    fetchNextMembers?: () => void;
    loadingMembers?: boolean;
    applicationStatus?: ApplicationStatusResult;
    timelineHasAnimated: boolean;
    setTimelineHasAnimated: (val: boolean) => void;
    onAcceptInvitation?: () => void;
    onDeclineInvitation?: () => void;
    invitationLoading?: boolean;
}

export function DashboardTab({
    project,
    isCreator,
    isCollaborator,
    members,
    rolesWithFilled,
    onEdit,
    onShare,
    onAdvanceStage,
    onRedoStage,
    onApplyToRole,
    onManageTeam,
    lifecycleStages,
    currentStageIndex,
    hasNextMembers,
    fetchNextMembers,
    loadingMembers,
    applicationStatus = { status: 'none' },
    timelineHasAnimated,
    setTimelineHasAnimated,
    onAcceptInvitation,
    onDeclineInvitation,
    invitationLoading,
}: DashboardTabProps) {
    const totalOpenPositions = useMemo(() => {
        return (rolesWithFilled || []).reduce((sum: number, role: any) => {
            const remaining = (role?.count || 0) - (role?.filled || 0);
            return sum + Math.max(0, remaining);
        }, 0);
    }, [rolesWithFilled]);



    const teamAndRoles = (
        <>
            <TabErrorBoundary tabName="Team">
                <Suspense fallback={<CardSkeleton />}>
                    <TeamCard
                        project={project}
                        members={members}
                        hasNextMembers={hasNextMembers}
                        fetchNextMembers={fetchNextMembers}
                        loadingMembers={loadingMembers}
                        isCreator={isCreator}
                        onInvite={onManageTeam}
                    />
                </Suspense>
            </TabErrorBoundary>
            {totalOpenPositions > 0 && (
                <OpenRolesCard
                    roles={rolesWithFilled}
                    isCreator={isCreator}
                    isCollaborator={isCollaborator}
                    applicationStatus={applicationStatus}
                    onApply={onApplyToRole}
                    onManageRoles={() => onEdit("roles")}
                    onAcceptInvitation={onAcceptInvitation}
                    onDeclineInvitation={onDeclineInvitation}
                    invitationLoading={invitationLoading}
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
                    membersCount={members.length + 1}
                    hideActionBar={true}
                    onShare={onShare}
                    lifecycleStages={lifecycleStages}
                    currentStageIndex={currentStageIndex}
                    onAdvanceStage={onAdvanceStage}
                    onRedoStage={onRedoStage}
                    timelineHasAnimated={timelineHasAnimated}
                    setTimelineHasAnimated={setTimelineHasAnimated}
                />


            </div>

            <div className="lg:col-span-5 space-y-6">
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
