'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProfilePageData, ProfilePrivacyRelationship, ProfileTabKey } from './types'
import type { ProfileCollaborationSummary, ProfileInviteProjectOption } from '@/lib/profile/collaboration'
import { ProfileShell } from './ProfileShell'
import { ProfileHeader } from './ProfileHeader'
import { ProfileRightRail } from './ProfileRightRail'
import { ProfileTabs } from './ProfileTabs'
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/use-auth';
import { invalidatePrivacyDependents } from '@/lib/privacy/client-invalidation';
import type { ConnectionState } from './types';
import { logger } from '@/lib/logger';
import { applyOptimisticUpdate as applyProfileOptimisticUpdate } from '@/lib/profile/normalization';
import { queryKeys } from '@/lib/query-keys';

// Section Imports (Kept static as they are usually in viewport)
import { AboutCard } from './sections/AboutCard'
import { ProjectContributionsCard } from './sections/ProjectContributionsCard'
import { SkillsCard } from './sections/SkillsCard'
import { OpenToRolesCard } from './sections/OpenToRolesCard'
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary'
import { ProjectsGridCard } from './sections/ProjectsGridCard'

type EditProfileModalComponent = typeof import('@/components/profile/edit/EditProfileModal')['EditProfileModal'];
type UserConnectionsModalComponent = typeof import('@/components/profile/v2/UserConnectionsModal')['UserConnectionsModal'];
type ProfileInviteModalComponent = typeof import('./ProfileInviteModal')['default'];
type ApplyRoleModalComponent = typeof import('@/components/projects/ApplyRoleModal')['default'];

interface ProfileClientProps extends Omit<ProfilePageData, 'stats'> {
    stats?: any;
    collaborationSummary?: ProfileCollaborationSummary;
    initialOpenRolesProjects?: any[];
    viewerHasOpenRoles?: boolean;
}

type EditSection = "general" | "experience" | "skills" | "social";

function parseProfileTab(value: string | null): ProfileTabKey {
    return value === 'portfolio' ? 'portfolio' : 'overview';
}

function connectionStateFromRelationship(relationship: ProfilePrivacyRelationship): ConnectionState {
    if (relationship.blockedByViewer || relationship.blockedByTarget) return 'blocked';
    if (relationship.connectionState === 'connected') return 'accepted';
    if (relationship.connectionState === 'pending_incoming') return 'pending_incoming';
    if (relationship.connectionState === 'pending_outgoing') return 'pending_outgoing';
    return 'none';
}

function connectionRequestKey() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `profile:${crypto.randomUUID()}`
        : `profile:${Date.now()}`;
}

type ApiEnvelope<T> = {
    success?: boolean
    data?: T
    error?: string
    message?: string
}

const EMPTY_COLLABORATION_SUMMARY: ProfileCollaborationSummary = {
    version: 1,
    generatedAt: '',
    projects: [],
    contributions: [],
    stats: {
        projectsCount: 0,
        visibleProjectsCount: 0,
        contributionCount: 0,
    },
}

async function readApiData<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => null) as ApiEnvelope<T> | null
    if (!response.ok || body?.success === false) {
        throw new Error(body?.error || body?.message || 'Request failed')
    }
    return (body?.data ?? body) as T
}

async function fetchProfileProjects(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/projects?limit=24`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ projects: any[]; total: number; hasMore: boolean }>(response)
}

async function fetchInviteOptions(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/project-invite-options`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ projects: ProfileInviteProjectOption[] }>(response)
}

async function fetchCollaborationSummary(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/collaboration-summary`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ summary: ProfileCollaborationSummary }>(response)
}

export function ProfileV2Client({
    profile,
    stats: initialStats,
    isOwner,
    currentUser,
    connectionStatus,
    privacyRelationship: initialPrivacyRelationship,
    lockedShell: initialLockedShell = false,
    collaborationSummary: initialCollaborationSummary = EMPTY_COLLABORATION_SUMMARY,
    initialOpenRolesProjects = [],
    viewerHasOpenRoles = false,
}: ProfileClientProps) {
    const { user: authUser } = useAuth()
    const viewerUser = authUser ?? currentUser
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const searchParamsString = searchParams.toString()
    const urlTab = parseProfileTab(searchParams.get('tab'))

    const [activeTab, setActiveTab] = useState<ProfileTabKey>(urlTab)
    const [liveProfile, setLiveProfile] = useState(profile)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [EditProfileModal, setEditProfileModal] = useState<EditProfileModalComponent | null>(null)
    const [UserConnectionsModal, setUserConnectionsModal] = useState<UserConnectionsModalComponent | null>(null)
    const [ProfileInviteModal, setProfileInviteModal] = useState<ProfileInviteModalComponent | null>(null)
    const [ApplyRoleModal, setApplyRoleModal] = useState<ApplyRoleModalComponent | null>(null)
    const [editSection, setEditSection] = useState<EditSection>('general')
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const [inviteOpen, setInviteOpen] = useState(false)
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false)
    const openRolesProjects = initialOpenRolesProjects
    const [status, setStatus] = useState<ConnectionState>(connectionStatus)
    const [privacyRelationship, setPrivacyRelationship] = useState(initialPrivacyRelationship)
    const [lockedShell, setLockedShell] = useState(initialLockedShell)
    const [isBlocking, setIsBlocking] = useState(false)
    const [viewerMutualCount, setViewerMutualCount] = useState((initialStats as any)?.mutualCount ?? 0)
    const [collaborationSummary, setCollaborationSummary] = useState<ProfileCollaborationSummary>(
        initialCollaborationSummary || EMPTY_COLLABORATION_SUMMARY,
    )

    useEffect(() => {
        setStatus(connectionStatus)
        setLiveProfile(profile)
        setPrivacyRelationship(initialPrivacyRelationship)
        setLockedShell(initialLockedShell)
        setViewerMutualCount((initialStats as any)?.mutualCount ?? 0)
        setCollaborationSummary(initialCollaborationSummary || EMPTY_COLLABORATION_SUMMARY)
    }, [connectionStatus, initialCollaborationSummary, initialLockedShell, initialPrivacyRelationship, initialStats, profile])

    useEffect(() => {
        setActiveTab(urlTab)
    }, [urlTab])

    const [isLoading, setIsLoading] = useState(false);

    const safeProfile = liveProfile as any
    const initialSummary = collaborationSummary || EMPTY_COLLABORATION_SUMMARY
    const portfolioQuery = useQuery({
        queryKey: profile?.id ? queryKeys.profile.projects(profile.id) : queryKeys.profile.projects('unknown'),
        queryFn: () => fetchProfileProjects(profile.id),
        enabled: Boolean(profile?.id && !lockedShell && (activeTab === 'portfolio' || isEditModalOpen)),
        staleTime: 60_000,
    })
    const inviteOptionsQuery = useQuery({
        queryKey: profile?.id ? queryKeys.profile.inviteOptions(profile.id) : queryKeys.profile.inviteOptions('unknown'),
        queryFn: () => fetchInviteOptions(profile.id),
        enabled: Boolean(profile?.id && inviteOpen && viewerUser && !isOwner),
        staleTime: 30_000,
    })
    const portfolioProjects = portfolioQuery.data?.projects ?? []
    const overviewProjects = initialSummary.projects ?? []
    const collaborationContributions = initialSummary.contributions ?? []
    const projectOptionsForEditing = portfolioProjects.length ? portfolioProjects : overviewProjects
    const safeStats = useMemo(
        () => ({
            ...(initialStats || {}),
            projectsCount: Number(initialStats?.projectsCount ?? initialSummary.stats?.projectsCount ?? overviewProjects.length ?? 0),
            mutualCount: viewerMutualCount,
        }),
        [initialStats, initialSummary.stats?.projectsCount, overviewProjects.length, viewerMutualCount],
    );

    const prefetchPortfolioProjects = useCallback(() => {
        if (!profile?.id || lockedShell) return
        void queryClient.prefetchQuery({
            queryKey: queryKeys.profile.projects(profile.id),
            queryFn: () => fetchProfileProjects(profile.id),
            staleTime: 60_000,
        })
    }, [lockedShell, profile?.id, queryClient])

    const prefetchInviteOptions = useCallback(() => {
        if (!profile?.id || !viewerUser || isOwner) return
        void queryClient.prefetchQuery({
            queryKey: queryKeys.profile.inviteOptions(profile.id),
            queryFn: () => fetchInviteOptions(profile.id),
            staleTime: 30_000,
        })
    }, [isOwner, profile?.id, queryClient, viewerUser])

    const prefetchProjectHref = useCallback((href: string) => {
        if (!href || !href.startsWith('/')) return
        router.prefetch(href)
    }, [router])

    const refreshCollaborationSummary = useCallback(async () => {
        if (!profile?.id) return
        const result = await queryClient.fetchQuery({
            queryKey: queryKeys.profile.collaborationSummary(profile.id),
            queryFn: () => fetchCollaborationSummary(profile.id),
            staleTime: 5_000,
        })
        setCollaborationSummary(result.summary)
        await queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(profile.username || profile.id) })
    }, [profile?.id, profile?.username, queryClient])



    const loadEditProfileModal = useCallback(async () => {
        if (EditProfileModal) return
        const mod = await import('@/components/profile/edit/EditProfileModal')
        setEditProfileModal(() => mod.EditProfileModal)
    }, [EditProfileModal])

    const loadUserConnectionsModal = useCallback(async () => {
        if (UserConnectionsModal) return
        const mod = await import('@/components/profile/v2/UserConnectionsModal')
        setUserConnectionsModal(() => mod.UserConnectionsModal)
    }, [UserConnectionsModal])

    const loadProfileInviteModal = useCallback(async () => {
        if (ProfileInviteModal) return
        const mod = await import('./ProfileInviteModal')
        setProfileInviteModal(() => mod.default)
    }, [ProfileInviteModal])

    const loadApplyRoleModal = useCallback(async () => {
        if (ApplyRoleModal) return
        const mod = await import('@/components/projects/ApplyRoleModal')
        setApplyRoleModal(() => mod.default)
    }, [ApplyRoleModal])

    const openEditModal = useCallback((section: EditSection = 'general') => {
        setEditSection(section)
        if (section === 'experience') {
            prefetchPortfolioProjects()
        }
        setIsEditModalOpen(true)
        void loadEditProfileModal()
    }, [loadEditProfileModal, prefetchPortfolioProjects])

    const handleTabChange = useCallback(
        (next: ProfileTabKey) => {
            if (next === 'portfolio') {
                prefetchPortfolioProjects()
            }
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
        [pathname, prefetchPortfolioProjects, router, searchParamsString],
    )

    const applyOptimisticProfileUpdate = useCallback((updates: Record<string, unknown>) => {
        setLiveProfile((current) => applyProfileOptimisticUpdate(current || {}, updates) as typeof current)
    }, [])

    const resolveConnectionId = async () => {
        const { checkConnectionStatus } = await import('@/app/actions/connections');
        const result = await checkConnectionStatus(profile.id);
        if (!result.success || !result.connectionId) {
            throw new Error(result.error || "Connection record not found");
        }
        return result.connectionId;
    };

    const refreshViewerOverlay = useCallback(async () => {
        if (!viewerUser || isOwner || !profile?.id) return;
        const { getProfileViewerOverlayAction } = await import('@/app/actions/profile');
        const result = await getProfileViewerOverlayAction(profile.id);
        if (!result.success) return;
        setPrivacyRelationship(result.privacyRelationship);
        setLockedShell(result.lockedShell);
        setViewerMutualCount(result.mutualCount);
        setStatus(connectionStateFromRelationship(result.privacyRelationship));
    }, [isOwner, profile?.id, viewerUser]);

    const handleConnectPrimary = async () => {
        if (!viewerUser || !profile) return;
        const prevStatus = status;
        setIsLoading(true);
        try {
            if (status === 'none' || status === 'rejected') {
                setStatus('pending_outgoing');
                const { sendConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(sendConnectionRequest(profile.id, connectionRequestKey()), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: (err) => err instanceof Error ? err.message : 'Failed to send request'
                });
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('accepted');
                const connectionId = await resolveConnectionId();
                const { acceptConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(acceptConnectionRequest(connectionId, { idempotencyKey: connectionId }), {
                    loading: 'Accepting request...',
                    success: 'Connection accepted',
                    error: (err) => err instanceof Error ? err.message : 'Failed to accept request'
                });
                await refreshViewerOverlay();
            }
        } catch (e) {
            setStatus(prevStatus);
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
        const prevStatus = status;
        setIsLoading(true);
        try {
            if (status === 'pending_outgoing') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { cancelConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(cancelConnectionRequest(connectionId), {
                    loading: 'Cancelling request...',
                    success: 'Request cancelled',
                    error: (err) => err instanceof Error ? err.message : 'Failed to cancel request'
                });
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { rejectConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(rejectConnectionRequest(connectionId), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: (err) => err instanceof Error ? err.message : 'Failed to decline request'
                });
                await refreshViewerOverlay();
            } else if (status === 'accepted') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { removeConnection } = await import('@/app/actions/connections');
                await toast.promise(removeConnection(connectionId), {
                    loading: 'Disconnecting...',
                    success: 'Disconnected',
                    error: (err) => err instanceof Error ? err.message : 'Failed to disconnect'
                });
                await refreshViewerOverlay();
            }
        } catch (e) {
            setStatus(prevStatus);
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

    const renderMainContent = () => {
        if (lockedShell) {
            return null
        }
        switch (activeTab) {
            case 'overview':
                return (
                    <div id="profile-panel-overview" role="tabpanel" aria-labelledby="profile-tab-overview">
                        <ComponentErrorBoundary fallbackMessage="Failed to load about section.">
                            <AboutCard
                                profile={safeProfile}
                                isOwner={isOwner}
                                onEdit={isOwner ? () => openEditModal('general') : undefined}
                            />
                        </ComponentErrorBoundary>
                    </div>
                )
            case 'portfolio':
                const visibleProjectsCount = Number(portfolioQuery.data?.total ?? safeStats.projectsCount ?? portfolioProjects.length ?? 0)
                const portfolioDescription = visibleProjectsCount > portfolioProjects.length
                    ? `Showing ${portfolioProjects.length} of ${visibleProjectsCount} visible projects`
                    : `Showcasing ${visibleProjectsCount} visible projects`
                return (
                    <div
                        id="profile-panel-portfolio"
                        role="tabpanel"
                        aria-labelledby="profile-tab-portfolio"
                    >
                        <ProjectsGridCard
                            projects={portfolioProjects}
                            title="Portfolio"
                            description={portfolioDescription}
                            isLoading={portfolioQuery.isLoading}
                            onProjectIntent={prefetchProjectHref}
                        />
                    </div>
                )
            default:
                return null
        }
    }

    const renderMainBottom = () => {
        if (lockedShell || activeTab !== 'overview') return null
        return (
            <ComponentErrorBoundary fallbackMessage="Failed to load project contributions.">
                <ProjectContributionsCard
                    contributions={collaborationContributions}
                    isOwner={isOwner}
                    onAdd={isOwner ? () => openEditModal('experience') : undefined}
                    projects={projectOptionsForEditing}
                    onProjectIntent={prefetchProjectHref}
                />
            </ComponentErrorBoundary>
        )
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
            await invalidatePrivacyDependents(queryClient, profile?.username || profile?.id || null)
            await refreshViewerOverlay()
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

    const inviteOptions = inviteOptionsQuery.data?.projects ?? []
    const handleOpenInvite = useCallback(() => {
        if (!viewerUser || isOwner) return
        prefetchInviteOptions()
        setInviteOpen(true)
        void loadProfileInviteModal()
    }, [isOwner, loadProfileInviteModal, prefetchInviteOptions, viewerUser])

    const handleOpenConnections = useCallback(() => {
        setShowConnectionsModal(true)
        void loadUserConnectionsModal()
    }, [loadUserConnectionsModal])

    const handleOpenApplyModal = useCallback(() => {
        setIsApplyModalOpen(true)
        void loadApplyRoleModal()
    }, [loadApplyRoleModal])



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
                    />
                }
                tabs={lockedShell ? null : (
                    <ProfileTabs
                        value={activeTab}
                        onChange={handleTabChange}
                        onIntent={(next) => {
                            if (next === 'portfolio') prefetchPortfolioProjects()
                        }}
                    />
                )}
                main={renderMainContent()}
                mainBottom={renderMainBottom()}
                highlights={lockedShell ? null : (
                    <>
                        <ComponentErrorBoundary fallbackMessage="Failed to load skills.">
                            <SkillsCard
                                skills={safeProfile.skills || []}
                                isOwner={isOwner}
                                onAdd={isOwner ? () => openEditModal('skills') : undefined}
                                variant="rail"
                            />
                        </ComponentErrorBoundary>
                        <ComponentErrorBoundary fallbackMessage="Failed to load role preferences.">
                            <OpenToRolesCard
                                openTo={safeProfile.openTo}
                                experienceLevel={safeProfile.experienceLevel}
                                hoursPerWeek={safeProfile.hoursPerWeek}
                                isOwner={isOwner}
                                onEdit={isOwner ? () => openEditModal('skills') : undefined}
                                onInvite={viewerUser && !isOwner && viewerHasOpenRoles ? handleOpenInvite : undefined}
                                onInviteIntent={prefetchInviteOptions}
                                onApply={viewerUser && !isOwner ? handleOpenApplyModal : undefined}
                                hasOpenRoles={openRolesProjects.length > 0}
                            />
                        </ComponentErrorBoundary>
                    </>
                )}
                rail={lockedShell ? null : (
                    <ProfileRightRail
                        profile={safeProfile}
                        stats={safeStats}
                        isOwner={isOwner}
                        socialLinks={safeProfile.socialLinks || []}
                        onConnectionsClick={handleOpenConnections}
                        onEditSection={openEditModal}
                    />
                )}
            />

            {isOwner && isEditModalOpen && EditProfileModal && (
                <EditProfileModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    profile={safeProfile}
                    contributions={collaborationContributions}
                    onOptimisticUpdate={applyOptimisticProfileUpdate}
                    initialSection={editSection}
                    onSaved={refreshCollaborationSummary}
                />
            )}

            {inviteOpen && ProfileInviteModal && (
                <ProfileInviteModal
                    isOpen={inviteOpen}
                    onClose={() => setInviteOpen(false)}
                    profileId={profile.id}
                    profileName={safeProfile.fullName || safeProfile.username || 'User'}
                    projects={inviteOptions}
                />
            )}

            {isApplyModalOpen && openRolesProjects.length > 0 && ApplyRoleModal && (
                <ApplyRoleModal
                    isOpen={isApplyModalOpen}
                    onClose={() => setIsApplyModalOpen(false)}
                    candidateProjects={openRolesProjects}
                />
            )}

            {showConnectionsModal && UserConnectionsModal ? (
                <UserConnectionsModal
                    isOpen={showConnectionsModal}
                    onClose={() => setShowConnectionsModal(false)}
                    userId={safeProfile.id}
                    userName={safeProfile.fullName || safeProfile.username || 'User'}
                />
            ) : null}
        </>
    )
}
