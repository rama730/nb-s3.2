'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProfilePageData, ProfilePrivacyRelationship, ProfileTabKey } from './types'
import type { ProfileCollaborationSummary, ProfileInviteProjectOption } from '@/lib/profile/collaboration'
import { ProfileShell } from './ProfileShell'
import { ProfileHeader } from './ProfileHeader'
import { ProfileRightRail } from './ProfileRightRail'
import { ProfileTabs } from './ProfileTabs'
import { useConnectionMutations } from '@/hooks/useConnections';
import { checkConnectionStatus } from '@/app/actions/connections';
import { getProfileViewerOverlayAction } from '@/app/actions/profile';
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
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary'

// Pure Optimization: Dynamic imports for Modals (Reduces initial bundle size by ~20%)
const EditProfileModal = dynamic(() => import('@/components/profile/edit/EditProfileModal').then(m => m.EditProfileModal), { ssr: false });
const UserConnectionsModal = dynamic(() => import('@/components/profile/v2/UserConnectionsModal').then(m => m.UserConnectionsModal), { ssr: false });
const ProjectsGridCard = dynamic(() => import('./sections/ProjectsGridCard').then(m => m.ProjectsGridCard), {
    loading: () => null,
    ssr: false,
});

interface ProfileClientProps extends Omit<ProfilePageData, 'projects' | 'stats'> {
    projects?: any[];
    stats?: any;
    collaborationSummary?: ProfileCollaborationSummary;
    viewerPreviewMode?: boolean;
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
    featuredProjects: [],
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
    projects: initialProjects = [],
    collaborationSummary: initialCollaborationSummary = EMPTY_COLLABORATION_SUMMARY,
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
    const [inviteOpen, setInviteOpen] = useState(false)
    const [selectedInviteProjectId, setSelectedInviteProjectId] = useState('')
    const [inviteNote, setInviteNote] = useState('')
    const [isSendingInvite, setIsSendingInvite] = useState(false)
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

    useEffect(() => {
        setCollaborationSummary(initialCollaborationSummary || EMPTY_COLLABORATION_SUMMARY)
    }, [initialCollaborationSummary])

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

    const safeProfile = liveProfile as any
    const initialSummary = collaborationSummary || EMPTY_COLLABORATION_SUMMARY
    const safeProjects = initialProjects || [];
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
    const portfolioProjects = portfolioQuery.data?.projects ?? safeProjects
    const overviewProjects = initialSummary.projects?.length ? initialSummary.projects : safeProjects.slice(0, 4)
    const collaborationContributions = initialSummary.contributions?.length
        ? initialSummary.contributions
        : (safeProfile?.experience || [])
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

    useEffect(() => {
        if (!inviteOpen || selectedInviteProjectId || !inviteOptionsQuery.data?.projects?.length) return
        setSelectedInviteProjectId(inviteOptionsQuery.data.projects[0]!.id)
    }, [inviteOpen, inviteOptionsQuery.data?.projects, selectedInviteProjectId])

    const openEditModal = useCallback((section: EditSection = 'general') => {
        setEditSection(section)
        if (section === 'experience') {
            prefetchPortfolioProjects()
        }
        setIsEditModalOpen(true)
    }, [prefetchPortfolioProjects])

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
        const result = await checkConnectionStatus(profile.id);
        if (!result.success || !result.connectionId) {
            throw new Error(result.error || "Connection record not found");
        }
        return result.connectionId;
    };

    const refreshViewerOverlay = useCallback(async () => {
        if (!viewerUser || isOwner || !profile?.id) return;
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
                await toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: (err) => err instanceof Error ? err.message : 'Failed to send request'
                });
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('accepted');
                const connectionId = await resolveConnectionId();
                await toast.promise(acceptRequest.mutateAsync(connectionId), {
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
                await toast.promise(cancelRequest.mutateAsync(connectionId), {
                    loading: 'Cancelling request...',
                    success: 'Request cancelled',
                    error: (err) => err instanceof Error ? err.message : 'Failed to cancel request'
                });
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                await toast.promise(rejectRequest.mutateAsync({ id: connectionId }), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: (err) => err instanceof Error ? err.message : 'Failed to decline request'
                });
                await refreshViewerOverlay();
            } else if (status === 'accepted') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                await toast.promise(disconnect.mutateAsync(connectionId), {
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
                        
                        <ComponentErrorBoundary fallbackMessage="Failed to load project contributions.">
                            <ProjectContributionsCard
                                contributions={collaborationContributions}
                                isOwner={isOwner}
                                onAdd={isOwner ? () => openEditModal('experience') : undefined}
                                projects={projectOptionsForEditing}
                                profileId={profile?.id}
                                onProjectIntent={prefetchProjectHref}
                                onStageUpdated={refreshCollaborationSummary}
                            />
                        </ComponentErrorBoundary>
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
    }, [isOwner, prefetchInviteOptions, viewerUser])

    const handleSendInvite = useCallback(async () => {
        if (!profile?.id || !selectedInviteProjectId || isSendingInvite) return
        setIsSendingInvite(true)
        try {
            const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profile.id)}/project-invites`, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    projectId: selectedInviteProjectId,
                    note: inviteNote,
                }),
            })
            await readApiData(response)
            toast.success('Project invite sent')
            setInviteOpen(false)
            setSelectedInviteProjectId('')
            setInviteNote('')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite')
        } finally {
            setIsSendingInvite(false)
        }
    }, [inviteNote, isSendingInvite, profile?.id, selectedInviteProjectId])

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
                rail={lockedShell ? null : (
                    <ProfileRightRail
                        profile={safeProfile}
                        stats={safeStats}
                        isOwner={isOwner}
                        socialLinks={safeProfile.socialLinks || []}
                        onInvite={!viewerPreviewMode && viewerUser && !isOwner ? handleOpenInvite : undefined}
                        onInviteIntent={prefetchInviteOptions}
                        onConnectionsClick={() => setShowConnectionsModal(true)}
                        onEditSection={openEditModal}
                    />
                )}
            />

            {isOwner && isEditModalOpen && (
                <EditProfileModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    profile={safeProfile}
                    onOptimisticUpdate={applyOptimisticProfileUpdate}
                    initialSection={editSection}
                    projects={projectOptionsForEditing}
                />
            )}

            {inviteOpen ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="profile-project-invite-title"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
                >
                    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 id="profile-project-invite-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                    Invite to project
                                </h2>
                                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                    {safeProfile.fullName || safeProfile.username || 'This collaborator'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setInviteOpen(false)}
                                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            >
                                Close
                            </button>
                        </div>

                        <div className="mt-5 space-y-4">
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-project-invite-project">
                                Project
                            </label>
                            <select
                                id="profile-project-invite-project"
                                value={selectedInviteProjectId}
                                onChange={(event) => setSelectedInviteProjectId(event.target.value)}
                                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
                                disabled={inviteOptionsQuery.isLoading || inviteOptions.length === 0}
                            >
                                {inviteOptionsQuery.isLoading ? (
                                    <option value="">Loading projects...</option>
                                ) : inviteOptions.length === 0 ? (
                                    <option value="">No managed projects available</option>
                                ) : (
                                    inviteOptions.map((project) => (
                                        <option key={project.id} value={project.id}>
                                            {project.title}
                                        </option>
                                    ))
                                )}
                            </select>

                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-project-invite-note">
                                Note
                            </label>
                            <textarea
                                id="profile-project-invite-note"
                                value={inviteNote}
                                onChange={(event) => setInviteNote(event.target.value.slice(0, 500))}
                                className="min-h-24 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
                                placeholder="Add a short invite note"
                            />

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setInviteOpen(false)}
                                    className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSendInvite}
                                    disabled={!selectedInviteProjectId || isSendingInvite || inviteOptions.length === 0}
                                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                                >
                                    {isSendingInvite ? 'Sending...' : 'Send invite'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {showConnectionsModal ? (
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
