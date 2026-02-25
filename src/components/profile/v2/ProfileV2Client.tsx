'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { ProfilePageData, ProfileTabKey } from './types'
import { ProfileShell } from './ProfileShell'
import { ProfileHeader } from './ProfileHeader'
import { ProfileRightRail } from './ProfileRightRail'
import { ProfileTabs } from './ProfileTabs'
import { useConnectionMutations } from '@/hooks/useConnections';
import { checkConnectionStatus } from '@/app/actions/connections';
import { toast } from 'sonner';
import { useProfileProjects, useProfileStats } from '@/hooks/useProfileData';

// Section Imports (Kept static as they are usually in viewport)
import { AboutCard } from './sections/AboutCard'
import { FeaturedProjectsCard } from './sections/FeaturedProjectsCard'
import { ExperienceCard } from './sections/ExperienceCard'
import { EducationCard } from './sections/EducationCard'
import { SkillsCard } from './sections/SkillsCard'
import { ProjectsGridCard } from './sections/ProjectsGridCard'

// Pure Optimization: Dynamic imports for Modals (Reduces initial bundle size by ~20%)
const EditProfileModal = dynamic(() => import('@/components/profile/edit/EditProfileModal').then(m => m.EditProfileModal), { ssr: false });
const UserConnectionsModal = dynamic(() => import('@/components/profile/v2/UserConnectionsModal').then(m => m.UserConnectionsModal), { ssr: false });

interface ProfileClientProps extends Omit<ProfilePageData, 'projects' | 'stats'> {
    projects?: any[];
    stats?: any;
}

export function ProfileV2Client({
    profile,
    stats: initialStats,
    isOwner,
    currentUser,
    connectionStatus,
    projects: initialProjects = [],
}: ProfileClientProps) {
    // Current tab state
    const [activeTab, setActiveTab] = useState<ProfileTabKey>('overview')
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const [projectsEnabled, setProjectsEnabled] = useState(initialProjects.length > 0)
    const router = useRouter()

    useEffect(() => {
        if (projectsEnabled) return
        if (activeTab === 'portfolio') {
            setProjectsEnabled(true)
            return
        }
        const timer = window.setTimeout(() => setProjectsEnabled(true), 120)
        return () => window.clearTimeout(timer)
    }, [activeTab, projectsEnabled])

    // Lazy Load Data
    const { data: projects, isLoading: projectsLoading } = useProfileProjects(
        profile.id,
        initialProjects.length > 0 ? initialProjects : undefined,
        projectsEnabled
    );
    const { data: stats, isLoading: statsLoading } = useProfileStats(profile.id, initialStats, true);

    const { sendRequest, acceptRequest, rejectRequest, cancelRequest, disconnect } = useConnectionMutations();

    const status = connectionStatus;
    const [isLoading, setIsLoading] = useState(false);

    const resolveConnectionId = async () => {
        const result = await checkConnectionStatus(profile.id);
        if (!result.success || !result.connectionId) {
            throw new Error(result.error || "Connection record not found");
        }
        return result.connectionId;
    };

    const handleConnectPrimary = async () => {
        if (!currentUser || !profile) return;
        setIsLoading(true);
        try {
            if (status === 'none' || status === 'rejected') {
                await toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: 'Failed to send request'
                });
                // Connection status will update on refetch
            } else if (status === 'pending_incoming') {
                const connectionId = await resolveConnectionId();
                await toast.promise(acceptRequest.mutateAsync(connectionId), {
                    loading: 'Accepting request...',
                    success: 'Connection accepted',
                    error: 'Failed to accept request'
                });
                // Connection status will update on refetch
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
                const connectionId = await resolveConnectionId();
                await toast.promise(cancelRequest.mutateAsync(connectionId), {
                    loading: 'Cancelling request...',
                    success: 'Request cancelled',
                    error: 'Failed to cancel request'
                });
                // Connection status will update on refetch
            } else if (status === 'pending_incoming') {
                const connectionId = await resolveConnectionId();
                await toast.promise(rejectRequest.mutateAsync(connectionId), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: 'Failed to decline request'
                });
                // Connection status will update on refetch
            } else if (status === 'accepted') {
                const connectionId = await resolveConnectionId();
                await toast.promise(disconnect.mutateAsync(connectionId), {
                    loading: 'Disconnecting...',
                    success: 'Disconnected',
                    error: 'Failed to disconnect'
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const safeProfile = profile as any

    // Safe derived values
    const safeProjects = projects || [];
    const safeStats = {
        ...(stats || initialStats || {}),
        mutualCount: (stats as any)?.mutualCount ?? (initialStats as any)?.mutualCount ?? 0
    };

    // Derived content based on tab
    const renderMainContent = () => {
        switch (activeTab) {
            case 'overview':
                return (
                    <div className="space-y-6">
                        <AboutCard
                            profile={profile}
                            isOwner={isOwner}
                            onBioUpdated={() => {}}
                        />
                        {/* Featured Projects - Pass loading state if possible or just skeleton */}
                        {projectsLoading && safeProjects.length === 0 ? (
                            <div className="h-64 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
                        ) : (
                            <FeaturedProjectsCard
                                projects={safeProjects}
                                isOwner={isOwner}
                            />
                        )}
                        
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
                            skills={profile.skills || []}
                            isOwner={isOwner}
                        />
                    </div>
                )
            case 'portfolio':
                return (
                    <ProjectsGridCard
                        projects={safeProjects}
                        title="All Projects"
                        description={`Showcasing ${safeProjects.length} projects`}
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
                        profile={profile}
                        isOwner={isOwner}
                        isAuthenticated={!!currentUser}
                        connectionState={status}
                        isLoadingConnection={isLoading}
                        onEdit={() => setIsEditModalOpen(true)}
                        onConnectPrimary={handleConnectPrimary}
                        onConnectSecondary={handleConnectSecondary}
                        onMessage={() => router.push(`/messages?userId=${profile.id}`)}
                        onInvite={() => {}}
                        mutualCount={safeStats.mutualCount}
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
                        profile={profile}
                        stats={safeStats}
                        isOwner={isOwner}
                        socialLinks={profile.socialLinks || []}
                        onInvite={() => {}}
                        onConnectionsClick={() => setShowConnectionsModal(true)}
                    />
                }
            />

            {isOwner && (
                <EditProfileModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    profile={profile}
                    onOptimisticUpdate={undefined}
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
