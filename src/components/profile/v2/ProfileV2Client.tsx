'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import type { ProfilePageData, ProfileTabKey } from './types'
import { ProfileShell } from './ProfileShell'
import { ProfileHeader } from './ProfileHeader'
import { ProfileRightRail } from './ProfileRightRail'
import { ProfileTabs } from './ProfileTabs'
import { useConnectionMutations } from '@/hooks/useConnections';
import { checkConnectionStatus } from '@/app/actions/connections';
import { toast } from 'sonner';
import { useProfileReadModel } from '@/hooks/useProfileData';
import { useAuth } from '@/lib/hooks/use-auth';
import { invalidatePrivacyDependents } from '@/lib/privacy/client-invalidation';
import type { ConnectionState } from './types';

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

function mapActionConnectionStatus(status?: string): ConnectionState {
    switch (status) {
        case 'connected':
            return 'accepted';
        case 'pending_sent':
            return 'pending_outgoing';
        case 'pending_received':
            return 'pending_incoming';
        case 'blocked':
            return 'blocked';
        case 'open':
        case 'none':
        default:
            return 'none';
    }
}

export function ProfileV2Client({
    profile,
    stats: initialStats,
    isOwner,
    currentUser,
    connectionStatus,
    privacyRelationship: initialPrivacyRelationship,
    lockedShell: initialLockedShell = false,
    projects: initialProjects = [],
}: ProfileClientProps) {
    const { user: authUser } = useAuth()
    const viewerUser = authUser ?? currentUser

    // Current tab state
    const [activeTab, setActiveTab] = useState<ProfileTabKey>('overview')
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const [projectsEnabled, setProjectsEnabled] = useState(initialProjects.length > 0)
    const [status, setStatus] = useState<ConnectionState>(connectionStatus)
    const [privacyRelationship, setPrivacyRelationship] = useState(initialPrivacyRelationship)
    const [lockedShell, setLockedShell] = useState(initialLockedShell)
    const [isBlocking, setIsBlocking] = useState(false)
    const router = useRouter()
    const queryClient = useQueryClient()

    useEffect(() => {
        setStatus(connectionStatus)
    }, [connectionStatus])

    useEffect(() => {
        setPrivacyRelationship(initialPrivacyRelationship)
        setLockedShell(initialLockedShell)
    }, [initialLockedShell, initialPrivacyRelationship])

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
    const { projects, stats, projectsLoading } = useProfileReadModel({
        profileId: profile.id,
        initialProjects: initialProjects.length > 0 ? initialProjects : undefined,
        initialStats,
        projectsEnabled,
    });

    const { sendRequest, acceptRequest, rejectRequest, cancelRequest, disconnect } = useConnectionMutations();

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!viewerUser || isOwner) return;

        let cancelled = false;
        void checkConnectionStatus(profile.id)
            .then((result) => {
                if (cancelled || !result.success) return;
                setStatus(mapActionConnectionStatus(result.status));
            })
            .catch(() => null);

        return () => {
            cancelled = true;
        };
    }, [viewerUser?.id, isOwner, profile.id]);

    const resolveConnectionId = async () => {
        const result = await checkConnectionStatus(profile.id);
        if (!result.success || !result.connectionId) {
            throw new Error(result.error || "Connection record not found");
        }
        return result.connectionId;
    };

    const handleConnectPrimary = async () => {
        if (!viewerUser || !profile) return;
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
        if (!viewerUser || !profile) return;
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

    const safeProfile = profile as any

    // Safe derived values
    const safeProjects = projects || [];
    const safeStats = {
        ...(stats || initialStats || {}),
        mutualCount: (stats as any)?.mutualCount ?? (initialStats as any)?.mutualCount ?? 0
    };

    // Derived content based on tab
    const renderMainContent = () => {
        if (lockedShell) {
            return null
        }
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

    const handleToggleBlock = async () => {
        if (!viewerUser || !profile?.id || privacyRelationship.blockedByTarget) return
        setIsBlocking(true)
        try {
            const isBlocked = privacyRelationship.blockedByViewer
            const res = await fetch(isBlocked ? `/api/v1/privacy/blocks/${profile.id}` : '/api/v1/privacy/blocks', {
                method: isBlocked ? 'DELETE' : 'POST',
                headers: isBlocked ? undefined : { 'Content-Type': 'application/json' },
                body: isBlocked ? undefined : JSON.stringify({ userId: profile.id }),
            })
            const json = await res.json().catch(() => null)
            if (!res.ok || json?.success === false) {
                throw new Error((typeof json?.error === 'string' && json.error) || 'Failed to update block state')
            }

            if (isBlocked) {
                setPrivacyRelationship((current) => ({
                    ...current,
                    blockedByViewer: false,
                    blockedByTarget: false,
                    connectionState: 'none',
                    canSendConnectionRequest: true,
                    canSendMessage: current.connectionState === 'connected',
                    canViewProfile: profile.visibility === 'public',
                    visibilityReason: profile.visibility === 'connections' ? 'connections_only' : profile.visibility === 'private' ? 'private' : 'public',
                }))
                setStatus('none')
                toast.success('Account unblocked')
            } else {
                setPrivacyRelationship((current) => ({
                    ...current,
                    blockedByViewer: true,
                    blockedByTarget: false,
                    connectionState: 'blocked_by_viewer',
                    canSendConnectionRequest: false,
                    canSendMessage: false,
                    canViewProfile: false,
                    visibilityReason: 'blocked',
                }))
                setLockedShell(true)
                setStatus('blocked')
                toast.success('Account blocked')
            }
            await invalidatePrivacyDependents(queryClient, {
                profileTargetKey: profile?.username || profile?.id || null,
                includeProjects: true,
            })
            router.refresh()
        } catch (error) {
            console.error(error)
            toast.error(error instanceof Error ? error.message : 'Failed to update block state')
        } finally {
            setIsBlocking(false)
        }
    }

    return (
        <>
            <ProfileShell
                header={
                    <ProfileHeader
                        profile={profile}
                        isOwner={isOwner}
                        isAuthenticated={!!viewerUser}
                        connectionState={status}
                        privacyRelationship={privacyRelationship}
                        lockedShell={lockedShell}
                        isLoadingConnection={isLoading}
                        isBlocking={isBlocking}
                        onEdit={() => setIsEditModalOpen(true)}
                        onConnectPrimary={handleConnectPrimary}
                        onConnectSecondary={handleConnectSecondary}
                        onMessage={() => router.push(`/messages?userId=${profile.id}`)}
                        onInvite={() => {}}
                        onToggleBlock={handleToggleBlock}
                        mutualCount={safeStats.mutualCount}
                    />
                }
                tabs={lockedShell ? null : (
                    <ProfileTabs
                        value={activeTab}
                        onChange={setActiveTab}
                    />
                )}
                main={renderMainContent()}
                rail={lockedShell ? null : (
                    <ProfileRightRail
                        profile={profile}
                        stats={safeStats}
                        isOwner={isOwner}
                        socialLinks={profile.socialLinks || []}
                        onInvite={() => {}}
                        onConnectionsClick={() => setShowConnectionsModal(true)}
                    />
                )}
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
