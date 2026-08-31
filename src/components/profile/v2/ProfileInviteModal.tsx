"use client";

import InviteCollaboratorModal, { type ParticipationProject } from "@/components/projects/dashboard/InviteCollaboratorModal";
import type { ProfileInviteProjectOption } from "@/lib/profile/collaboration";

interface ProfileInviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    profileId: string;
    profileName: string;
    projects: ProfileInviteProjectOption[];
}

/** Profile entry point for the same Invite Collaborator module used on a Team card. */
export default function ProfileInviteModal({ isOpen, onClose, profileId, profileName, projects }: ProfileInviteModalProps) {
    const projectOptions: ParticipationProject[] = projects.map((project) => ({
        id: project.id,
        title: project.title,
        slug: project.slug,
        role: project.role,
    }));
    return <InviteCollaboratorModal isOpen={isOpen} onClose={onClose} projects={projectOptions} candidate={{ id: profileId, fullName: profileName, username: null, avatarUrl: null, headline: null }} />;
}
