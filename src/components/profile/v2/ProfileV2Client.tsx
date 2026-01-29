'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ProfilePageData, ProfileTabKey } from './types'
import { ProfileShell } from './ProfileShell'
import { ProfileHeader } from './ProfileHeader'
import { ProfileRightRail } from './ProfileRightRail'
import { ProfileTabs } from './ProfileTabs'
import { useConnectionMutations } from '@/hooks/useConnections';
import { toast } from 'sonner';
import { EditProfileModal } from '@/components/profile/edit/EditProfileModal'
import { UserConnectionsModal } from '@/components/profile/v2/UserConnectionsModal';

// Sections
import { AboutCard } from './sections/AboutCard'
import { FeaturedProjectsCard } from './sections/FeaturedProjectsCard'
import { ExperienceCard } from './sections/ExperienceCard'
import { EducationCard } from './sections/EducationCard'
import { SkillsCard } from './sections/SkillsCard'
import { ProjectsGridCard } from './sections/ProjectsGridCard'
import { ActivityFeedContainer } from './sections/ActivityFeedContainer'

export function ProfileV2Client({
    profile,
    stats,
    isOwner,
    currentUser,
    connectionStatus,
    projects = [],
}: ProfilePageData) {
    // Current tab state
    const [activeTab, setActiveTab] = useState<ProfileTabKey>('overview')
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const router = useRouter()

    // OPTIMISTIC STATE ("Smooth Working"):
    // Initialized from server prop, but updated locally for instant feedback
    const [optimisticProfile, setOptimisticProfile] = useState(profile);

    // Sync if server prop changes (e.g. navigation)
    useEffect(() => {
        setOptimisticProfile(profile);
    }, [profile]);

    // Handler for optimistic updates from children
    const handleOptimisticUpdate = (updates: Partial<typeof profile>) => {
        setOptimisticProfile(prev => ({ ...prev, ...updates }));
    };

    // Use simplified hooks
    const { sendRequest } = useConnectionMutations();

    const [status, setStatus] = useState<any>(connectionStatus);
    const [isLoading, setIsLoading] = useState(false);

    // Sync with prop if it changes (e.g. from re-fetch)
    useEffect(() => {
        setStatus(connectionStatus);
    }, [connectionStatus]);

    const handleConnectPrimary = async () => {
        if (!currentUser || !profile) return;
        setIsLoading(true);
        try {
            if (status === 'none') {
                toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: 'Failed to send request'
                });
                setStatus('pending_outgoing');
            } else if (status === 'pending_incoming') {
                toast.error("Please accept via the Connections tab for now");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnectSecondary = async () => {
        if (!currentUser || !profile) return;
        setIsLoading(true);
        try {
            if (status === 'pending_outgoing') {
                toast.error("Please manage pending requests in Connections tab");
            } else if (status === 'accepted') {
                toast.error("Please disconnect via the Connections tab");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to safely access missing schema fields
    const safeProfile = optimisticProfile as any

    // Derived content based on tab
    const renderMainContent = () => {
        switch (activeTab) {
            case 'overview':
                return (
                    <div className="space-y-6">
                        <AboutCard
                            profile={optimisticProfile}
                            isOwner={isOwner}
                            onBioUpdated={(bio) => handleOptimisticUpdate({ bio })}
                        />
                        <FeaturedProjectsCard
                            projects={projects}
                            isOwner={isOwner}
                        />
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <ExperienceCard
                                experiences={safeProfile.experience || []}
                                isOwner={isOwner}
                            />
                            <EducationCard
                                education={safeProfile.education || []}
                                isOwner={isOwner}
                            />
                        </div>
                        <SkillsCard
                            skills={optimisticProfile.skills || []}
                            isOwner={isOwner}
                        />
                    </div>
                )
            case 'portfolio':
                return (
                    <ProjectsGridCard
                        projects={projects}
                        title="All Projects"
                        description={`Showcasing ${projects.length} projects`}
                    />
                )
            default:
                return null
        }
    }

    return (
        <>
            <ProfileShell
                header={
                    <ProfileHeader
                        profile={optimisticProfile}
                        isOwner={isOwner}
                        isAuthenticated={!!currentUser}
                        connectionState={status}
                        isLoadingConnection={isLoading}
                        onEdit={() => setIsEditModalOpen(true)}
                        onConnectPrimary={handleConnectPrimary}
                        onConnectSecondary={handleConnectSecondary}
                        onMessage={() => router.push(`/messages?userId=${optimisticProfile.id}`)}
                        onInvite={() => {}}
                    />
                }
                tabs={
                    <ProfileTabs
                        value={activeTab}
                        onChange={setActiveTab}
                    />
                }
                main={renderMainContent()}
                rail={
                    <ProfileRightRail
                        profile={optimisticProfile}
                        stats={stats}
                        isOwner={isOwner}
                        socialLinks={optimisticProfile.socialLinks || []}
                        onInvite={() => {}}
                        onConnectionsClick={() => setShowConnectionsModal(true)}
                    />
                }
            />

            {isOwner && (
                <EditProfileModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    profile={optimisticProfile}
                    onOptimisticUpdate={handleOptimisticUpdate}
                />
            )}

            <UserConnectionsModal
                isOpen={showConnectionsModal}
                onClose={() => setShowConnectionsModal(false)}
                userId={profile.id}
                userName={profile.fullName || profile.username || 'User'}
            />
        </>
    )
}
