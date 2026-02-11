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
    const router = useRouter()

    // Lazy Load Data
    const { data: projects, isLoading: projectsLoading } = useProfileProjects(profile.id, initialProjects.length > 0 ? initialProjects : undefined);
    const { data: stats, isLoading: statsLoading } = useProfileStats(profile.id, initialStats);

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
    const { sendRequest, acceptRequest, rejectRequest, cancelRequest, disconnect } = useConnectionMutations();

    const [status, setStatus] = useState<any>(connectionStatus);
    const [isLoading, setIsLoading] = useState(false);

    // Sync with prop if it changes (e.g. from re-fetch)
    useEffect(() => {
        setStatus(connectionStatus);
    }, [connectionStatus]);

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
                setStatus('pending_outgoing');
            } else if (status === 'pending_incoming') {
                const connectionId = await resolveConnectionId();
                await toast.promise(acceptRequest.mutateAsync(connectionId), {
                    loading: 'Accepting request...',
                    success: 'Connection accepted',
                    error: 'Failed to accept request'
                });
                setStatus('accepted');
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
                setStatus('none');
            } else if (status === 'pending_incoming') {
                const connectionId = await resolveConnectionId();
                await toast.promise(rejectRequest.mutateAsync(connectionId), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: 'Failed to decline request'
                });
                setStatus('none');
            } else if (status === 'accepted') {
                const connectionId = await resolveConnectionId();
                await toast.promise(disconnect.mutateAsync(connectionId), {
                    loading: 'Disconnecting...',
                    success: 'Disconnected',
                    error: 'Failed to disconnect'
                });
                setStatus('none');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to safely access missing schema fields
    const safeProfile = optimisticProfile as any

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
                            profile={optimisticProfile}
                            isOwner={isOwner}
                            onBioUpdated={(bio) => handleOptimisticUpdate({ bio })}
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
                            skills={optimisticProfile.skills || []}
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
                        profile={optimisticProfile}
                        stats={safeStats}
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
