"use client";

import ProjectOverviewCard from "@/components/projects/dashboard/ProjectOverviewCard";
import TeamCard from "@/components/projects/dashboard/TeamCard";
import OpenRolesCard from "@/components/projects/dashboard/OpenRolesCard";
import { TabErrorBoundary } from "@/components/projects/TabErrorBoundary";

import { type ApplicationStatusResult } from "@/app/actions/applications";

interface DashboardTabProps {
    project: any;
    isCreator: boolean;
    isCollaborator: boolean;
    canManageTeam?: boolean;
    members: any[];
    rolesWithFilled: any[];
    onEdit: () => void;
    onAdvanceStage: () => void;
    onRedoStage?: () => void;
    onApplyToRole: (role: any) => void;
    onManageTeam: () => void;
    lifecycleStages: any[];
    currentStageIndex: number;
    loadingMembers?: boolean;
    applicationStatus?: ApplicationStatusResult;
    onAcceptInvitation?: () => void;
    onDeclineInvitation?: () => void;
    invitationLoading?: boolean;
}

export function DashboardTab({
    project,
    isCreator,
    isCollaborator,
    canManageTeam,
    members,
    rolesWithFilled,
    onEdit,
    onAdvanceStage,
    onRedoStage,
    onApplyToRole,
    onManageTeam,
    lifecycleStages,
    currentStageIndex,
    loadingMembers,
    applicationStatus = { status: 'none' },
    onAcceptInvitation,
    onDeclineInvitation,
    invitationLoading,
}: DashboardTabProps) {
    const teamAndRoles = (
        <>
            <TabErrorBoundary tabName="Team">
                <TeamCard
                    project={project}
                    members={members}
                    loadingMembers={loadingMembers}
                    isCreator={isCreator}
                    canInvite={canManageTeam}
                    onInvite={onManageTeam}
                />
            </TabErrorBoundary>
            <OpenRolesCard
                roles={rolesWithFilled}
                isCreator={isCreator}
                isCollaborator={isCollaborator}
                applicationStatus={applicationStatus}
                onApply={onApplyToRole}
                onManageRoles={onEdit}
                onAcceptInvitation={onAcceptInvitation}
                onDeclineInvitation={onDeclineInvitation}
                invitationLoading={invitationLoading}
            />
        </>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
                <ProjectOverviewCard
                    project={project}
                    isCreator={isCreator}
                    lifecycleStages={lifecycleStages}
                    currentStageIndex={currentStageIndex}
                    onAdvanceStage={onAdvanceStage}
                    onRedoStage={onRedoStage}
                />
            </div>

            <div className="lg:col-span-5 space-y-6">
                {teamAndRoles}
            </div>
        </div>
    );
}

export default DashboardTab;
