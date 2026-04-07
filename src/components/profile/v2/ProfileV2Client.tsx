'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
import { useAuth } from '@/lib/hooks/use-auth';
import { invalidatePrivacyDependents } from '@/lib/privacy/client-invalidation';
import type { ConnectionState } from './types';
import { logger } from '@/lib/logger';
import { applyOptimisticUpdate as applyProfileOptimisticUpdate } from '@/lib/profile/normalization';

// Section Imports (Kept static as they are usually in viewport)
import { AboutCard } from './sections/AboutCard'
import { FeaturedProjectsCard } from './sections/FeaturedProjectsCard'
import { ExperienceCard } from './sections/ExperienceCard'
import { EducationCard } from './sections/EducationCard'
import { SkillsCard } from './sections/SkillsCard'
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary'
import { ProjectsGridCard } from './sections/ProjectsGridCard'

// Pure Optimization: Dynamic imports for Modals (Reduces initial bundle size by ~20%)
const EditProfileModal = dynamic(() => import('@/components/profile/edit/EditProfileModal').then(m => m.EditProfileModal), { ssr: false });
const UserConnectionsModal = dynamic(() => import('@/components/profile/v2/UserConnectionsModal').then(m => m.UserConnectionsModal), { ssr: false });

interface ProfileClientProps extends Omit<ProfilePageData, 'projects' | 'stats'> {
    projects?: any[];
    stats?: any;
    viewerPreviewMode?: boolean;
}

type EditSection = "general" | "experience" | "education" | "skills" | "social";

function parseProfileTab(value: string | null): ProfileTabKey {
    return value === 'portfolio' ? 'portfolio' : 'overview';
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
    viewerPreviewMode = false,
}: ProfileClientProps) {
    const { user: authUser } = useAuth()
    const viewerUser = viewerPreviewMode ? null : (authUser ?? currentUser)
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const searchParamsString = searchParams.toString()
    const urlTab = parseProfileTab(searchParams.get('tab'))

    const [activeTab, setActiveTab] = useState<ProfileTabKey>(urlTab)
    const [liveProfile, setLiveProfile] = useState(profile)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [editSection, setEditSection] = useState<EditSection>('general')
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const [status, setStatus] = useState<ConnectionState>(connectionStatus)
    const [privacyRelationship, setPrivacyRelationship] = useState(initialPrivacyRelationship)
    const [lockedShell, setLockedShell] = useState(initialLockedShell)
    const [isBlocking, setIsBlocking] = useState(false)
    const [viewerMutualCount, setViewerMutualCount] = useState((initialStats as any)?.mutualCount ?? 0)

    useEffect(() => {
        setStatus(connectionStatus)
    }, [connectionStatus])

    useEffect(() => {
        setLiveProfile(profile)
    }, [profile])

    useEffect(() => {
        setActiveTab(urlTab)
    }, [urlTab])

    useEffect(() => {
        setPrivacyRelationship(initialPrivacyRelationship)
        setLockedShell(initialLockedShell)
    }, [initialLockedShell, initialPrivacyRelationship])

    useEffect(() => {
        setViewerMutualCount((initialStats as any)?.mutualCount ?? 0)
    }, [initialStats])

    const { sendRequest, acceptRequest, rejectRequest, cancelRequest, disconnect } = useConnectionMutations();

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!viewerUser || isOwner) return;
        setStatus(connectionStatus);
        setPrivacyRelationship(initialPrivacyRelationship);
        setLockedShell(initialLockedShell);
            setViewerMutualCount((initialStats as any)?.mutualCount ?? 0);
    }, [
        viewerUser,
        isOwner,
        connectionStatus,
        initialPrivacyRelationship,
        initialLockedShell,
        initialStats,
    ]);

    const safeProjects = initialProjects || [];
    const safeStats = useMemo(
        () => ({
            ...(initialStats || {}),
            projectsCount: Number(initialStats?.projectsCount ?? safeProjects.length ?? 0),
            mutualCount: viewerMutualCount,
        }),
        [initialStats, safeProjects.length, viewerMutualCount],
    );

    const openEditModal = useCallback((section: EditSection = 'general') => {
        setEditSection(section)
        setIsEditModalOpen(true)
    }, [])

    const handleTabChange = useCallback(
        (next: ProfileTabKey) => {
            setActiveTab(next)
            const params = new URLSearchParams(searchParamsString)
            if (next === 'overview') {
                params.delete('tab')
            } else {
                params.set('tab', next)
            }
            const query = params.toString()
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
        },
        [pathname, router, searchParamsString],
    )

    const applyOptimisticProfileUpdate = useCallback((updates: Record<string, unknown>) => {
        setLiveProfile((current) => applyProfileOptimisticUpdate(current || {}, updates) as typeof current)
    }, [])

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
            logger.error('[ProfileV2Client] primary connection action failed', {
                module: 'profile',
                profileId: profile.id,
                viewerUserId: viewerUser?.id ?? null,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
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
                await toast.promise(rejectRequest.mutateAsync({ id: connectionId }), {
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
            logger.error('[ProfileV2Client] secondary connection action failed', {
                module: 'profile',
                profileId: profile.id,
                viewerUserId: viewerUser?.id ?? null,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const safeProfile = liveProfile as any
    const publicProfileHref = safeProfile?.username ? `/u/${safeProfile.username}` : null

    const renderMainContent = () => {
        if (lockedShell) {
            return null
        }
        switch (activeTab) {
            case 'overview':
                return (
                    <div
                        id="profile-panel-overview"
                        role="tabpanel"
                        aria-labelledby="profile-tab-overview"
                        className="space-y-6"
                    >
                        <ComponentErrorBoundary fallbackMessage="Failed to load about section.">
                            <AboutCard
                                profile={safeProfile}
                                isOwner={isOwner}
                                onEdit={isOwner ? () => openEditModal('general') : undefined}
                            />
                        </ComponentErrorBoundary>
                        <ComponentErrorBoundary fallbackMessage="Failed to load projects.">
                            <FeaturedProjectsCard
                                projects={safeProjects}
                                isOwner={isOwner}
                            />
                        </ComponentErrorBoundary>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <ComponentErrorBoundary fallbackMessage="Failed to load experience.">
                                <ExperienceCard
                                    experiences={safeProfile.experience || []}
                                    isOwner={isOwner}
                                    onAdd={isOwner ? () => openEditModal('experience') : undefined}
                                />
                            </ComponentErrorBoundary>
                            <ComponentErrorBoundary fallbackMessage="Failed to load education.">
                                <EducationCard
                                    education={safeProfile.education || []}
                                    isOwner={isOwner}
                                    onAdd={isOwner ? () => openEditModal('education') : undefined}
                                />
                            </ComponentErrorBoundary>
                        </div>
                        <ComponentErrorBoundary fallbackMessage="Failed to load skills.">
                            <SkillsCard
                                skills={safeProfile.skills || []}
                                isOwner={isOwner}
                                onAdd={isOwner ? () => openEditModal('skills') : undefined}
                            />
                        </ComponentErrorBoundary>
                    </div>
                )
            case 'portfolio':
                const visibleProjectsCount = Number(safeStats.projectsCount ?? safeProjects.length ?? 0)
                const portfolioDescription = visibleProjectsCount > safeProjects.length
                    ? `Showing ${safeProjects.length} of ${visibleProjectsCount} visible projects`
                    : `Showcasing ${visibleProjectsCount} visible projects`
                return (
                    <div
                        id="profile-panel-portfolio"
                        role="tabpanel"
                        aria-labelledby="profile-tab-portfolio"
                    >
                        <ProjectsGridCard
                            projects={safeProjects}
                            title="Portfolio"
                            description={portfolioDescription}
                        />
                    </div>
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
                const nextConnectionState = 'none'
                const nextVisibilityReason = profile.visibility === 'connections'
                    ? 'connections_only'
                    : profile.visibility === 'private'
                        ? 'private'
                        : 'public'
                const nextCanViewProfile = profile.visibility === 'public'
                const nextCanSendMessage = profile.messagePrivacy === 'everyone'

                setPrivacyRelationship((current) => ({
                    ...current,
                    blockedByViewer: false,
                    blockedByTarget: false,
                    connectionState: nextConnectionState,
                    canSendConnectionRequest: true,
                    canSendMessage: nextCanSendMessage,
                    canViewProfile: nextCanViewProfile,
                    visibilityReason: nextVisibilityReason,
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
            logger.error('[ProfileV2Client] block toggle failed', {
                module: 'profile',
                profileId: profile.id,
                viewerUserId: viewerUser?.id ?? null,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
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
                            profile={safeProfile}
                            viewerId={viewerUser?.id ?? null}
                            isOwner={isOwner}
                            isAuthenticated={!!viewerUser}
                            connectionState={status}
                        privacyRelationship={privacyRelationship}
                        lockedShell={lockedShell}
                        isLoadingConnection={isLoading}
                        isBlocking={isBlocking}
                        onEdit={() => openEditModal('general')}
                        onConnectPrimary={handleConnectPrimary}
                        onConnectSecondary={handleConnectSecondary}
                        onMessage={() => router.push(`/messages?userId=${safeProfile.id}`)}
                        onToggleBlock={handleToggleBlock}
                        mutualCount={safeStats.mutualCount}
                        publicProfileHref={publicProfileHref}
                    />
                }
                tabs={lockedShell ? null : (
                    <ProfileTabs
                        value={activeTab}
                        onChange={handleTabChange}
                    />
                )}
                main={renderMainContent()}
                rail={lockedShell ? null : (
                    <ProfileRightRail
                        profile={safeProfile}
                        stats={safeStats}
                        isOwner={isOwner}
                        socialLinks={safeProfile.socialLinks || []}
                        onInvite={() => {}}
                        onConnectionsClick={() => setShowConnectionsModal(true)}
                        onEditSection={openEditModal}
                        publicProfileHref={publicProfileHref}
                    />
                )}
            />

            {isOwner && (
                <EditProfileModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    profile={safeProfile}
                    onOptimisticUpdate={applyOptimisticProfileUpdate}
                    initialSection={editSection}
                />
            )}

            <UserConnectionsModal
                isOpen={showConnectionsModal}
                onClose={() => setShowConnectionsModal(false)}
                userId={safeProfile.id}
                userName={safeProfile.fullName || safeProfile.username || 'User'}
            />
        </>
    )
}
