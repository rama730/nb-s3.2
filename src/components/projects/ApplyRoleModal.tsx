"use client";

import InviteCollaboratorModal, { type ParticipationProject, type ParticipationRole } from "@/components/projects/dashboard/InviteCollaboratorModal";

type ProjectRef = { id: string; title: string; slug?: string | null };

interface ApplyRoleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    project?: ProjectRef;
    roles?: ParticipationRole[];
    preselectedRoleId?: string;
    candidateProjects?: { id: string; title: string; slug?: string | null; openRoles: ParticipationRole[] }[];
}

/** Compatibility entry point: applications now use the Invite Collaborator recruitment surface. */
export default function ApplyRoleModal({ isOpen, onClose, onSuccess, project, roles, preselectedRoleId, candidateProjects }: ApplyRoleModalProps) {
    const projects: ParticipationProject[] | undefined = candidateProjects?.map((item) => ({ ...item, openRoles: item.openRoles }));
    return <InviteCollaboratorModal isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} mode="apply" projectId={project?.id} projectTitle={project?.title} roles={roles} projects={projects} preselectedRoleId={preselectedRoleId} />;
}
