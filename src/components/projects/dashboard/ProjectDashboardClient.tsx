'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import ProjectLayout from '@/components/projects/dashboard/ProjectLayout';
import { TabErrorBoundary } from '@/components/projects/TabErrorBoundary';
import type { Project } from '@/types/hub';
import { toggleProjectFollowAction, updateProjectStageAction, incrementProjectViewAction } from '@/app/actions/project';
import { getApplicationStatusAction, acceptProposedRoleAction, declineProposedRoleAction, type ApplicationStatusResult } from '@/app/actions/applications';
import { resolveMessageWorkflowActionV2 } from '@/app/actions/messaging';
import { resolveProjectInvitationAction } from '@/app/actions/project/guidance';
import { useProjectMembers } from '@/hooks/hub/useProjectMembers';
import { filesFeatureFlags } from '@/lib/features/files';
import { getProjectNodes } from '@/app/actions/files/nodes';
import { queryKeys } from '@/lib/query-keys';
import { logger } from '@/lib/logger';
import { subscribeProjectStage } from '@/lib/realtime/subscriptions';
import type { SprintDetailPayload } from '@/lib/projects/sprint-detail';
import type { TaskPanelTab } from '@/hooks/useTaskPanelResource';
import { normalizeProjectDocSlug } from '@/lib/projects/doc-slug';
import { canProjectMemberUploadFiles, isProjectTabVisibleToViewer, normalizeProjectMemberRole, normalizeProjectPublicTabVisibility, resolveAllowedProjectTab, type ProjectMemberRole } from '@/lib/projects/settings-policies';
import {
    useUIStore,
    WORKSPACE_TASK_HANDOFF_STORAGE_KEY,
    readWorkspaceTaskHandoff,
    type WorkspaceTaskHandoff,
} from '@/lib/stores/ui-store';

import { DashboardTab, DocTab, UpdatesTab, TasksTab, FilesTab, AnalyticsTab, SprintPlanning, ProjectSettingsTab, ProjectPrivacyTermsTab } from '@/components/projects/dashboard/ProjectTabsRegistry';
import { confirmFileNavigation } from '@/lib/files/unsaved-navigation';
import { useFilesWorkspaceStore } from '@/stores/filesWorkspaceStore';

const EditProjectModal = dynamic(() => import('@/components/projects/EditProjectModal'), { ssr: false, loading: () => null });

const InviteCollaboratorModal = dynamic(() => import('@/components/projects/dashboard/InviteCollaboratorModal'), { ssr: false, loading: () => null });

const ApplyRoleModal = dynamic(() => import('@/components/projects/ApplyRoleModal'), { ssr: false, loading: () => null });

const ProjectOnboardingModal = dynamic(() => import('@/components/projects/ProjectOnboardingModal').then((mod) => mod.ProjectOnboardingModal), { ssr: false, loading: () => null });

function normalizeProjectDetailTabParam(value: string | null | undefined) {
    const tab = value?.trim();
    if (!tab) return 'dashboard';
    return tab === 'docs' ? 'readme' : tab;
}

function projectDetailTabQueryParam(tabId: string) {
    return tabId === 'readme' ? 'docs' : tabId;
}

function deleteParam(params: URLSearchParams, key: string) {
    if (!params.has(key)) return false;
    params.delete(key);
    return true;
}

function clearProjectDetailScopedParams(params: URLSearchParams, activeTab: string, resetActiveTab = false) {
    let changed = false;

    if (resetActiveTab || activeTab !== 'tasks') {
        for (const key of ['drawerType', 'drawerId', 'panelTab']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'files') {
        for (const key of ['fileId', 'path', 'line', 'column', 'filesView', 'filesTask']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'updates') {
        for (const key of ['updateId', 'commentId']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'readme') {
        changed = deleteParam(params, 'doc') || changed;
        changed = deleteParam(params, 'readmeMode') || changed;
    }

    if (resetActiveTab || activeTab !== 'analytics') {
        for (const key of ['analyticsTab', 'memberId', 'analyticsMember', 'analyticsSource', 'analyticsWindow']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    return changed;
}

interface ExtendedProjectDetail extends Omit<Project, 'publicTabVisibility'> {
    publicTabVisibility?: Project['publicTabVisibility'] | string;
    public_tab_visibility?: string;
    hasPublishedReadme?: boolean;
    isFollowed?: boolean;
    followersCount?: number;
    viewCount?: number;
    currentStageIndex?: number;
    stageCompletionDates?: Record<string, string>;
    membersHasMore?: boolean;
    membersNextCursor?: string | null;
    guidance?: unknown;
}

interface ProjectDashboardClientProps {
    project: ExtendedProjectDetail;
    currentUserId: string | null;
    viewerDisplayName?: string | null;
    viewerAvatarUrl?: string | null;
    isOwner: boolean;
    isMember: boolean;
    initialSprintData?: SprintDetailPayload | null;
}

export default function ProjectDashboardClient({ project, currentUserId, viewerDisplayName = null, viewerAvatarUrl = null, isOwner, isMember, initialSprintData = null }: ProjectDashboardClientProps) {
    const router = useRouter();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const workspaceTaskHandoff = useUIStore((state) => state.workspaceTaskHandoff);
    const setWorkspaceTaskHandoff = useUIStore((state) => state.setWorkspaceTaskHandoff);
    const [sessionTaskHandoff, setSessionTaskHandoff] = useState<WorkspaceTaskHandoff | null>(() => {
        if (typeof window === 'undefined') return null;
        const handoff = readWorkspaceTaskHandoff(window.sessionStorage.getItem(WORKSPACE_TASK_HANDOFF_STORAGE_KEY));
        return handoff?.projectId === project.id ? handoff : null;
    });
    useEffect(() => {
        if (workspaceTaskHandoff || typeof window === 'undefined') return;
        try {
            const stored = readWorkspaceTaskHandoff(
                window.sessionStorage.getItem(WORKSPACE_TASK_HANDOFF_STORAGE_KEY),
            );
            if (stored?.projectId === project.id) setSessionTaskHandoff(stored);
            else window.sessionStorage.removeItem(WORKSPACE_TASK_HANDOFF_STORAGE_KEY);
        } catch {
            try {
                window.sessionStorage.removeItem(WORKSPACE_TASK_HANDOFF_STORAGE_KEY);
            } catch {
                // Storage is unavailable; no persisted handoff can be used.
            }
        }
    }, [project.id, workspaceTaskHandoff]);
    const pendingWorkspaceTaskHandoff = workspaceTaskHandoff ?? sessionTaskHandoff;
    const workspaceInitialTaskId =
        pendingWorkspaceTaskHandoff?.projectId === project.id
            ? pendingWorkspaceTaskHandoff.taskId
            : null;
    const applyRoleIdFromUrl = searchParams?.get('applyRole') || null;

    // Keep the handoff alive until TasksTab has actually opened the panel.
    // Clearing it on dashboard mount races the lazy task-tab mount.
    const consumeWorkspaceTaskHandoff = useCallback(() => {
        if (pendingWorkspaceTaskHandoff?.projectId === project.id) {
            setWorkspaceTaskHandoff(null);
            setSessionTaskHandoff(null);
            try {
                window.sessionStorage.removeItem(WORKSPACE_TASK_HANDOFF_STORAGE_KEY);
            } catch {
                // The in-memory handoff is already consumed.
            }
        }
    }, [pendingWorkspaceTaskHandoff, project.id, setWorkspaceTaskHandoff]);
    // The detail shell already resolves viewer-safe guidance in parallel with
    // the rest of the project header. Avoid a second client POST on every open.
    const guidance = (project as { guidance?: unknown }).guidance ?? null;

    const invalidateProjectDetailSlices = useCallback(
        (options?: { shell?: boolean; shellRefresh?: boolean; tasks?: boolean; sprints?: boolean; analytics?: boolean; members?: boolean; files?: boolean }) => {
            const o = options ?? {};
            if (o.shell) {
                if (project.slug) {
                    void queryClient.invalidateQueries({
                        queryKey: queryKeys.project.bySlug(project.slug),
                    });
                }
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.byId(project.id),
                });
                if (o.shellRefresh) {
                    router.refresh();
                }
            }
            if (o.tasks) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.tasksRoot(project.id),
                });
            }
            if (o.sprints) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.sprints(project.id),
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.sprintTasksRoot(project.id),
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.sprintDetailRoot(project.id),
                });
            }
            if (o.analytics) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.analytics(project.id),
                });
            }
            if (o.members) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.members(project.id),
                });
            }
            if (o.files) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.filesNodes(project.id, null),
                });
            }
        },
        [project.id, project.slug, queryClient, router],
    );

    // Active tab from URL or default
    const canonicalProjectHref = useMemo(() => `/projects/${project.slug || project.id}`, [project.id, project.slug]);
    const publicTabVisibility = useMemo(() => normalizeProjectPublicTabVisibility(project.publicTabVisibility ?? project.public_tab_visibility), [project]);
    const isOwnerOrMember = isOwner || isMember;
    const resolvedActiveTab = resolveAllowedProjectTab({
        requestedTab: (() => {
            const searchTab = searchParams?.get('tab');
            const requested = normalizeProjectDetailTabParam(searchTab);
            if (requested === 'readme' && !isOwnerOrMember && !project.hasPublishedReadme) {
                // Ponytail: Allow docs tab to be visible natively.
            }
            return requested;
        })(),
        isOwnerOrMember,
        canManageSettings: isOwner,
        publicTabVisibility,
    });

    const [activeTab, setActiveTab] = useState(() => resolvedActiveTab);

    const refreshProjectData = useCallback(
        (scopeTab?: string) => {
            const targetTab = scopeTab || activeTab;
            invalidateProjectDetailSlices({
                shell: true,
                shellRefresh: true,
                tasks: targetTab === 'tasks' || targetTab === 'dashboard',
                sprints: targetTab === 'sprints',
                analytics: targetTab === 'analytics',
                members: true,
                files: targetTab === 'files',
            });
        },
        [activeTab, invalidateProjectDetailSlices],
    );

    const [isDocEditing, setIsReadmeEditing] = useState(false);

    // State management
    const [isFollowing, setIsFollowing] = useState(project.isFollowed || false);
    const [followLoading, setFollowLoading] = useState(false);
    const [followersCount, setFollowersCount] = useState(project.followersCount || 0);
    const [viewCount, setViewCount] = useState(project.viewCount || 0);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [preselectedRoleId, setPreselectedRoleId] = useState<string | undefined>(undefined);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isStageUpdating, setIsStageUpdating] = useState(false);
    const [, setStageVersion] = useState<string | null>(project.updatedAt || null);
    const stageVersionRef = useRef<string | null>(project.updatedAt || null);
    const isStageUpdatingRef = useRef(false);
    const isMountedRef = useRef(true);
    const followRequestRef = useRef(0);
    const followInFlightRef = useRef(false);
    const shareRequestRef = useRef(0);
    const stageRequestRef = useRef(0);
    const roleApplyRequestRef = useRef<string | null>(null);

    const setStageVersionSafe = useCallback((nextVersion: string | null) => {
        stageVersionRef.current = nextVersion;
        setStageVersion(nextVersion);
    }, []);

    const setIsStageUpdatingSafe = useCallback((next: boolean) => {
        isStageUpdatingRef.current = next;
        setIsStageUpdating(next);
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const handleProjectSettingsUpdated = useCallback(
        (_updates?: { coverImage?: string | null }) => {
            refreshProjectData();
        },
        [refreshProjectData],
    );

    // Initial Onboarding Check (Workspace Bridge)
    useEffect(() => {
        const source = searchParams?.get('source');
        if (source === 'application_accepted' && (isMember || isOwner)) {
            setIsOnboardingOpen(true);
            // Clean URL
            const url = new URL(window.location.href);
            url.searchParams.delete('source');
            window.history.replaceState({}, '', url);
        }
    }, [searchParams, isMember, isOwner]);

    // Ponytail: Keep browser URL canonical (clean slug instead of numeric UUID)
    useEffect(() => {
        if (!project.slug || typeof window === 'undefined') return;
        const currentPath = window.location.pathname;
        const expectedPath = `/projects/${project.slug}`;
        if (currentPath !== expectedPath && currentPath.startsWith('/projects/')) {
            const url = new URL(window.location.href);
            url.pathname = expectedPath;
            window.history.replaceState(window.history.state, '', url);
        }
    }, [project.slug]);

    // Application status for non-owner/non-member users
    const [applicationStatus, setApplicationStatus] = useState<ApplicationStatusResult>({ status: 'none' });
    const [invitationLoading, setInvitationLoading] = useState(false);

    const handleInvitation = useCallback(async (action: 'accept' | 'decline') => {
        if (invitationLoading) return;
        setInvitationLoading(true);
        try {
            let res;
            if (applicationStatus.applicationId) {
                res = action === 'accept'
                    ? await acceptProposedRoleAction(applicationStatus.applicationId)
                    : await declineProposedRoleAction(applicationStatus.applicationId);
            } else if (applicationStatus.workflowItemId) {
                res = await resolveMessageWorkflowActionV2({
                    workflowItemId: applicationStatus.workflowItemId,
                    action,
                });
            } else if (applicationStatus.invitationId) {
                res = await resolveProjectInvitationAction({
                    invitationId: applicationStatus.invitationId,
                    action,
                });
            } else {
                throw new Error('No active invitation ID found.');
            }

            if (res.success) {
                toast.success(action === 'accept' ? 'Invitation accepted successfully!' : 'Invitation declined.');
                refreshProjectData();
                const nextStatus = await getApplicationStatusAction(project.id);
                setApplicationStatus(nextStatus);
            } else {
                toast.error(res.error || (action === 'accept' ? 'Failed to accept invitation' : 'Failed to decline invitation'));
            }
        } catch (error) {
            console.error(`Error ${action === 'accept' ? 'accepting' : 'declining'} invitation:`, error);
            toast.error(error instanceof Error ? error.message : action === 'accept' ? 'Failed to accept invitation' : 'Failed to decline invitation');
        } finally {
            setInvitationLoading(false);
        }
    }, [applicationStatus, invitationLoading, project.id, refreshProjectData]);

    // Optimistic State for Project Journey
    const [optimisticStageIndex, setOptimisticStageIndex] = useState(project.currentStageIndex || 0);
    const [stageCompletionDates, setStageCompletionDates] = useState<Record<string, string>>(() => project.stageCompletionDates || {});

    // Sync state with server updates (e.g. revalidation or external changes)
    // This ensures we don't get stuck in a detached state if the server updates
    const serverStageIndex = project.currentStageIndex || 0;
    const serverProjectUpdatedAt = project.updatedAt || null;
    useEffect(() => {
        setOptimisticStageIndex(serverStageIndex);
        setStageCompletionDates(project.stageCompletionDates || {});
    }, [serverStageIndex, project.stageCompletionDates]);

    // Realtime subscription for project stage changes
    useEffect(() => {
        if (!project?.id) return;
        const supabase = createClient();
        const channel = subscribeProjectStage({
            supabase,
            projectId: project.id,
            onUpdate: (payload: any) => {
                if (isStageUpdatingRef.current) return;

                const nextIndex = payload.new?.current_stage_index;
                if (nextIndex !== undefined && nextIndex !== null) {
                    setOptimisticStageIndex(Number(nextIndex));
                }
                const nextDates = payload.new?.stage_completion_dates;
                if (nextDates !== undefined && nextDates !== null) {
                    setStageCompletionDates(nextDates as Record<string, string>);
                }
                const nextVersion = payload.new?.updated_at;
                if (typeof nextVersion === 'string') {
                    setStageVersionSafe(nextVersion);
                }
                // ponytail: sync stats on the same unified channel without separate broadcast channel
                const nextViews = payload.new?.view_count;
                if (typeof nextViews === 'number') {
                    setViewCount((current: number) => Math.max(current, nextViews));
                }
                const nextFollowers = payload.new?.followers_count;
                if (typeof nextFollowers === 'number') {
                    setFollowersCount(nextFollowers);
                }
            },
        });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [project?.id, setStageVersionSafe]);

    // Extended project data (may come from joined queries, cast to any for flexibility)
    const projectWithLiveStats = useMemo(
        () => ({
            ...(project as any),
            viewCount,
            followersCount,
            stageCompletionDates,
            guidance,
        }),
        [project, viewCount, followersCount, stageCompletionDates, guidance],
    );
    const extendedProject = projectWithLiveStats as any;

    const lastProjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!project?.id) return;
        if (lastProjectIdRef.current === project.id) return;
        lastProjectIdRef.current = project.id;
        setFollowersCount(project.followersCount || 0);
        setViewCount(project.viewCount || 0);
        setIsFollowing(project.isFollowed || false);
        setStageVersionSafe(serverProjectUpdatedAt);
    }, [project?.id, serverProjectUpdatedAt, setStageVersionSafe]);

    // OPTIMIZATION: Default to empty arrays as these are now fetched client-side or lazy loaded
    const tasks = useMemo(() => extendedProject?.tasks || [], [extendedProject]);
    const sprints = useMemo(() => {
        if (initialSprintData?.sprints?.length) return initialSprintData.sprints;
        return extendedProject?.sprints || [];
    }, [extendedProject, initialSprintData?.sprints]);

    const collaboratorUsers = useMemo(() => {
        const list = (extendedProject?.collaborators || []) as any[];
        return list
            .map((c) =>
                c?.user
                    ? {
                          ...c.user,
                          membershipRole: c.membershipRole,
                          projectRoleTitle: c.projectRoleTitle ?? null,
                          joinedAt: c.joinedAt ?? null,
                      }
                    : null,
            )
            .filter(Boolean);
    }, [extendedProject]);

    const rolesWithFilled = useMemo(() => {
        const roles = extendedProject?.openRoles || [];
        return roles.map((role: any) => ({
            ...role,
            filled: role?.filled ?? 0,
        }));
    }, [extendedProject]);

    // Fetch application status for non-owners (lightweight O(1) query)
    useEffect(() => {
        if (!currentUserId || isOwner || isMember) return;

        getApplicationStatusAction(project.id).then(setApplicationStatus);
    }, [project.id, currentUserId, isOwner, isMember]);

    // Hook Integration: Scalable Member Loading
    const shouldLoadMembers = activeTab === 'dashboard' || activeTab === 'tasks' || activeTab === 'updates' || activeTab === 'sprints' || activeTab === 'settings';

    const {
        data: membersData,
        isLoading: loadingMembers,
    } = useProjectMembers(project.id, collaboratorUsers || [], {
        enabled: shouldLoadMembers,
        initialHasMore: project.membersHasMore,
        initialCursor: project.membersNextCursor,
        pageSize: 20,
    });

    // Flatten members and include owner
    const allMembers = useMemo(() => {
        const collab = membersData?.pages.flatMap((p: any) => p.members) || collaboratorUsers || [];
        const owner = (extendedProject?.owner || project.owner) as { id: string } | undefined;

        const list = [...collab];
        if (owner && !list.find((m) => m.id === owner.id)) {
            list.unshift(owner);
        }
        return list;
    }, [membersData, collaboratorUsers, project, extendedProject]);
    const currentProjectRole = useMemo<ProjectMemberRole | null>(() => {
        if (isOwner) return 'owner';
        if (!currentUserId) return null;
        const member = allMembers.find((item: any) => item?.id === currentUserId);
        return member ? normalizeProjectMemberRole((member as any).membershipRole, 'member') : null;
    }, [allMembers, currentUserId, isOwner]);
    const canManageProjectSettings = isOwner || currentProjectRole === 'admin';
    const canEditTasks = isOwner || currentProjectRole === 'admin' || currentProjectRole === 'member';
    const canManageFiles = isOwner || currentProjectRole === 'admin';
    const currentFileMember = allMembers.find((item: any) => item?.id === currentUserId);
    const canUploadFiles = isOwner || canProjectMemberUploadFiles({ role: currentProjectRole, fileUploadEnabled: currentFileMember?.fileUploadEnabled });
    const canReadTaskFiles = isProjectTabVisibleToViewer({ tabId: 'tasks', isOwnerOrMember, publicTabVisibility });

    const currentUserName = useMemo(() => {
        if (!currentUserId) return undefined;
        const member = allMembers.find((item: any) => item?.id === currentUserId);
        return member?.displayName || member?.fullName || member?.name || viewerDisplayName || 'Anonymous';
    }, [allMembers, currentUserId, viewerDisplayName]);
    const currentUserAvatarUrl = useMemo(() => {
        if (!currentUserId) return undefined;
        const member = allMembers.find((item: any) => item?.id === currentUserId);
        return member?.avatarUrl || member?.profile?.avatarUrl || member?.user?.avatarUrl || viewerAvatarUrl || null;
    }, [allMembers, currentUserId, viewerAvatarUrl]);
    const canCreateUpdates = isOwner || currentProjectRole === 'admin' || currentProjectRole === 'member';
    const canManageUpdates = canManageProjectSettings;

    // Current members
    const members = useMemo(() => {
        return membersData?.pages.flatMap((p: any) => p.members) || collaboratorUsers || [];
    }, [membersData, collaboratorUsers]);

    const lifecycleStageNames = useMemo(() => {
        return (Array.isArray(extendedProject?.lifecycleStages) && extendedProject.lifecycleStages.length > 0 ? extendedProject.lifecycleStages : Array.isArray((extendedProject as any)?.lifecycle_stages) && (extendedProject as any).lifecycle_stages.length > 0 ? (extendedProject as any).lifecycle_stages : []) as string[];
    }, [extendedProject]);

    const lifecycleStages = useMemo(() => {
        const stages = lifecycleStageNames;
        const currentIndex = optimisticStageIndex;
        return stages.map((stageName: string, idx: number) => ({
            name: stageName,
            status: idx < currentIndex ? 'completed' : idx === currentIndex ? 'current' : 'upcoming',
        }));
    }, [lifecycleStageNames, optimisticStageIndex]);

    // Tab change handler
    const handleTabChange = useCallback(
        (tabId: string) => {
            if (!confirmFileNavigation(project.id)) return;
            if (
                !isProjectTabVisibleToViewer({
                    tabId,
                    isOwnerOrMember,
                    canManageSettings: canManageProjectSettings,
                    publicTabVisibility,
                })
            ) {
                toast.error('That project tab is not visible for your current access.');
                return;
            }
            if (tabId === activeTab) {
                // If they click the current tab, clear any tab-specific parameters to reset tab view/drawer
                const nextParams = new URLSearchParams(window.location.search);
                const changed = clearProjectDetailScopedParams(nextParams, tabId, true);
                if (changed) {
                    const nextQuery = nextParams.toString();
                    const safePath = pathname ?? window.location.pathname;
                    const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
                    router.replace(nextUrl, { scroll: false });
                }
                return;
            }
            setActiveTab(tabId);

            const nextParams = new URLSearchParams(window.location.search);
            if (tabId === 'readme') {
                nextParams.set('tab', 'docs');
                if (!nextParams.has('doc')) {
                    nextParams.set('doc', 'readme');
                }
            } else {
                nextParams.set('tab', tabId);
            }

            // Clean up other tab-specific query parameters when switching tabs
            clearProjectDetailScopedParams(nextParams, tabId);

            const nextQuery = nextParams.toString();
            const safePath = pathname ?? window.location.pathname;
            const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
            router.replace(nextUrl, { scroll: false });
        },
        [activeTab, canManageProjectSettings, isOwnerOrMember, pathname, publicTabVisibility, router],
    );

    // Keep the URL canonical from the URL state itself. This avoids the tab
    // rollback that happens when optimistic local tab state cleans a stale URL.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const nextParams = new URLSearchParams(searchParams?.toString() ?? window.location.search);
        const requestedTab = normalizeProjectDetailTabParam(nextParams.get('tab'));
        const normalizedRequestedTab = requestedTab;
        const allowedTab = resolveAllowedProjectTab({
            requestedTab: normalizedRequestedTab,
            isOwnerOrMember,
            canManageSettings: canManageProjectSettings,
            publicTabVisibility,
        });
        let changed = false;

        if (allowedTab === 'dashboard') {
            changed = deleteParam(nextParams, 'tab') || changed;
        } else {
            const encodedTab = projectDetailTabQueryParam(allowedTab);
            if (nextParams.get('tab') !== encodedTab) {
                nextParams.set('tab', encodedTab);
                changed = true;
            }
        }

        if (allowedTab === 'readme') {
            const currentDocSlug = nextParams.get('doc');
            const normalizedDocSlug = normalizeProjectDocSlug(currentDocSlug || 'readme');
            if (currentDocSlug !== normalizedDocSlug) {
                nextParams.set('doc', normalizedDocSlug);
                changed = true;
            }
        }

        changed = clearProjectDetailScopedParams(nextParams, allowedTab) || changed;

        if (!changed) return;
        const nextQuery = nextParams.toString();
        const safePath = pathname ?? window.location.pathname;
        const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
        router.replace(nextUrl, { scroll: false });
    }, [
        canManageProjectSettings,
        isOwnerOrMember,
        pathname,
        project.id,
        project.slug,

        publicTabVisibility,
        router,
        searchParams
    ]);

    useEffect(() => {
        const searchTab = searchParams?.get('tab');
        const requestedTab = normalizeProjectDetailTabParam(searchTab);
        const normalizedRequestedTab = requestedTab;
        const nextTab = resolveAllowedProjectTab({
            requestedTab: normalizedRequestedTab,
            isOwnerOrMember,
            canManageSettings: canManageProjectSettings,
            publicTabVisibility,
        });
        setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
    }, [
        canManageProjectSettings,
        isOwnerOrMember,
        project.id,
        project.slug,

        publicTabVisibility,
        searchParams
    ]);

    useEffect(() => {
        if (activeTab !== 'readme') setIsReadmeEditing(false);
    }, [activeTab]);

    const handleTabHover = useCallback(
        (tabId: string) => {
            // Warm only the surface the user is expressing intent to open.
            // Data prefetch stays scoped below so hovering one tab never fans
            // out requests for the rest of the project workspace.
            switch (tabId) {
                case 'readme':
                    void import('@/components/projects/tabs/DocTab');
                    break;
                case 'updates':
                    void import('@/components/projects/tabs/UpdatesTab');
                    break;
                case 'sprints':
                    void import('@/components/projects/tabs/SprintPlanning');
                    break;
                case 'tasks':
                    void import('@/components/projects/v2/TasksTab');
                    break;
                case 'analytics':
                    void import('@/components/projects/tabs/AnalyticsTab');
                    break;
                case 'settings':
                    void import('@/components/projects/tabs/ProjectSettingsTab');
                    break;
                case 'privacy':
                    void import('@/components/projects/tabs/ProjectPrivacyTermsTab');
                    break;
                case 'files':
                    void import('@/components/projects/v2/files-tab/FilesTabRoot');
                    break;
                default:
                    break;
            }
        },
        [],
    );



    // Actions
    const handleEdit = useCallback(() => {
        setIsEditModalOpen(true);
    }, []);

    const handleShare = useCallback(async () => {
        const requestId = ++shareRequestRef.current;
        try {
            const shareUrl = new URL(canonicalProjectHref, window.location.origin).toString();
            const shareData: ShareData = {
                title: project.title,
                text: project.shortDescription || project.description || undefined,
                url: shareUrl,
            };
            if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                await navigator.share(shareData);
                if (!isMountedRef.current || requestId !== shareRequestRef.current) return;
                toast.success('Share sheet opened');
                logger.metric('project.detail.share.result', {
                    projectId: project.id,
                    mode: 'native-share',
                    success: true,
                    kind: 'url',
                });
                return;
            }
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
                if (!isMountedRef.current || requestId !== shareRequestRef.current) return;
                toast.success('Link copied to clipboard');
                logger.metric('project.detail.share.result', {
                    projectId: project.id,
                    mode: 'clipboard',
                    success: true,
                });
                return;
            }
            throw new Error('Sharing is unavailable in this browser');
        } catch (error) {
            if (!isMountedRef.current || requestId !== shareRequestRef.current) return;
            const isAbort = error instanceof Error && error.name === 'AbortError';
            if (isAbort) return;
            const message = error instanceof Error ? error.message : 'Failed to share project link';
            toast.error(message);
            logger.metric('project.detail.share.result', {
                projectId: project.id,
                success: false,
                message,
            });
        }
    }, [canonicalProjectHref, project.description, project.id, project.shortDescription, project.title]);

    const handleFollow = useCallback(async () => {
        if (followLoading || followInFlightRef.current) return;
        if (!currentUserId) {
            toast.error('Please log in to follow projects');
            return;
        }
        // Optimistic update
        const requestId = ++followRequestRef.current;
        const baselineFollowersCount = followersCount;
        const newIsFollowing = !isFollowing;
        setIsFollowing(newIsFollowing);
        setFollowersCount((c: number) => (newIsFollowing ? c + 1 : Math.max(0, c - 1)));

        try {
            setFollowLoading(true);
            followInFlightRef.current = true;
            const result = await toggleProjectFollowAction(project.id, newIsFollowing);
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            if (!result.success) throw new Error(result.error);
            if (result.followersCount !== undefined) {
                const serverCount = Math.max(0, result.followersCount);
                const reconciledCount = newIsFollowing ? Math.max(serverCount, baselineFollowersCount + 1) : Math.min(serverCount, Math.max(0, baselineFollowersCount - 1));
                setFollowersCount(reconciledCount);

                // Invalidate the Hub project feed query cache
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.hub.projectsSimpleRoot(),
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.globalSearch.hubRoot(),
                });
            }
            toast.success(newIsFollowing ? 'Following project' : 'Unfollowed project');
            logger.metric('project.detail.follow.result', {
                projectId: project.id,
                userId: currentUserId,
                success: true,
                isFollowing: newIsFollowing,
            });
        } catch (error) {
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            // Revert
            setIsFollowing(!newIsFollowing);
            setFollowersCount(Math.max(0, baselineFollowersCount));
            const message = error instanceof Error ? error.message : 'Failed to update follow status';
            toast.error(message);
            logger.metric('project.detail.follow.result', {
                projectId: project.id,
                userId: currentUserId,
                success: false,
                isFollowing: newIsFollowing,
                message,
            });
        } finally {
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            followInFlightRef.current = false;
            setFollowLoading(false);
        }
    }, [currentUserId, followLoading, followersCount, isFollowing, project.id]);

    useEffect(() => {
        if (!project?.id) return;
        let cancelled = false;
        const sessionKey = `project:view:${project.id}`;
        try {
            if (window.sessionStorage.getItem(sessionKey)) return;
        } catch {
            // Storage can be unavailable in privacy-restricted browser modes.
        }

        const incrementView = () => {
            if (cancelled || document.visibilityState !== 'visible') return;
            incrementProjectViewAction(project.id).then((result) => {
                if (cancelled) return;
                if (!isMountedRef.current) return;
                const nextViewCount = result.viewCount;
                if (result.success && typeof nextViewCount === 'number') {
                    try {
                        window.sessionStorage.setItem(sessionKey, '1');
                    } catch {
                        // Counting remains best-effort when storage is unavailable.
                    }
                    setViewCount((current: number) => Math.max(current, nextViewCount));

                    logger.metric('project.detail.view.increment', {
                        projectId: project.id,
                        success: true,
                        viewCount: nextViewCount,
                    });
                } else {
                    logger.metric('project.detail.view.increment', {
                        projectId: project.id,
                        success: false,
                        message: result.error || 'increment failed',
                    });
                }
            });
        };
        let idleId: number | null = null;
        let timeoutId: number | null = null;
        if (typeof window.requestIdleCallback === 'function') {
            idleId = window.requestIdleCallback(incrementView, { timeout: 10_000 });
        } else {
            timeoutId = window.setTimeout(incrementView, 5_000);
        }
        return () => {
            cancelled = true;
            if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(idleId);
            }
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [project?.id]);

    const handleApplyToRole = useCallback(
        (role: any) => {
            if (!currentUserId) {
                toast.error('Please log in to apply');
                return;
            }
            if (isOwner || isMember) {
                toast.error('Project members cannot apply for an additional role');
                return;
            }

            // Check if user has an existing application that blocks re-application
            if (applicationStatus.status === 'pending') {
                toast.error('You already have a pending application');
                return;
            }

            if (applicationStatus.status === 'rejected' && !applicationStatus.canReapply) {
                toast.error(`You can reapply in ${applicationStatus.waitTime}`);
                return;
            }

            // Open the apply modal, optionally with a preselected role
            setPreselectedRoleId(role?.id || undefined);
            setIsApplyModalOpen(true);
        },
        [currentUserId, applicationStatus, isMember, isOwner],
    );

    useEffect(() => {
        if (!applyRoleIdFromUrl) {
            roleApplyRequestRef.current = null;
            return;
        }

        if (roleApplyRequestRef.current === applyRoleIdFromUrl) return;

        const role = rolesWithFilled.find((item: any) => item?.id === applyRoleIdFromUrl);
        if (!role) return;

        roleApplyRequestRef.current = applyRoleIdFromUrl;
        setActiveTab('dashboard');
        handleApplyToRole(role);
    }, [applyRoleIdFromUrl, handleApplyToRole, rolesWithFilled]);

    const commitStageIndex = useCallback(
        async (targetIndex: number, expectedUpdatedAt: string | null, allowRetry = true): Promise<boolean> => {
            const requestId = ++stageRequestRef.current;
            setIsStageUpdatingSafe(true);
            try {
                const result = await updateProjectStageAction(project.id, targetIndex, {
                    expectedUpdatedAt: expectedUpdatedAt || undefined,
                });

                if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;

                if (result.success) {
                    const nextIndex = typeof result.currentStageIndex === 'number' ? result.currentStageIndex : targetIndex;
                    setOptimisticStageIndex(nextIndex);
                    setStageVersionSafe(result.updatedAt ?? null);
                    if (result.stageCompletionDates) {
                        setStageCompletionDates(result.stageCompletionDates);
                    }
                    return true;
                }

                if (result.errorCode === 'PROJECT_CONFLICT' && allowRetry && result.latest) {
                    const latestIndex = Math.max(0, result.latest.currentStageIndex ?? 0);
                    const latestVersion = result.latest.updatedAt ?? null;
                    setOptimisticStageIndex(latestIndex);
                    setStageVersionSafe(latestVersion);

                    if (latestIndex >= targetIndex) {
                        toast.info('Stage updated from another session. Synced latest stage.');
                        return true;
                    }

                    const retryTarget = Math.min(Math.max(0, lifecycleStageNames.length - 1), latestIndex + 1);
                    const retryResult = await updateProjectStageAction(project.id, retryTarget, {
                        expectedUpdatedAt: latestVersion || undefined,
                    });

                    if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;

                    if (retryResult.success) {
                        const nextIndex = typeof retryResult.currentStageIndex === 'number' ? retryResult.currentStageIndex : retryTarget;
                        setOptimisticStageIndex(nextIndex);
                        setStageVersionSafe(retryResult.updatedAt ?? latestVersion);
                        if (retryResult.stageCompletionDates) {
                            setStageCompletionDates(retryResult.stageCompletionDates);
                        }
                        return true;
                    }

                    toast.error(retryResult.error || 'Failed to update stage after sync');
                    return false;
                }

                toast.error(result.error || 'Failed to update stage');
                return false;
            } catch (error) {
                if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;
                toast.error(error instanceof Error ? error.message : 'Failed to update project stage');
                return false;
            } finally {
                if (isMountedRef.current && requestId === stageRequestRef.current) {
                    setIsStageUpdatingSafe(false);
                }
            }
        },
        [lifecycleStageNames.length, project.id, setIsStageUpdatingSafe, setStageVersionSafe],
    );

    const moveStage = useCallback(async (delta: 1 | -1) => {
        if (isStageUpdating) {
            toast.info('Stage update is in progress');
            return;
        }
        if (!isOwner) {
            toast.error(delta > 0 ? 'Only the project owner can advance the stage' : 'Only the project owner can revert the stage');
            return;
        }

        const stages = lifecycleStageNames;
        const prevIndex = optimisticStageIndex;
        const nextIndex = prevIndex + delta;
        if (nextIndex < 0) {
            toast.info('Project is already at the starting stage');
            return;
        }
        if (nextIndex >= stages.length) {
            toast.info('Project is already at the final stage');
            return;
        }

        const expectedUpdatedAt = stageVersionRef.current;
        setOptimisticStageIndex(nextIndex);

        const committed = await commitStageIndex(nextIndex, expectedUpdatedAt, true);
        if (!committed) {
            setOptimisticStageIndex(prevIndex);
            return;
        }
        toast.success(delta > 0 ? `Advanced to ${stages[nextIndex]}` : `Returned to ${stages[nextIndex]}`);
    }, [commitStageIndex, isOwner, isStageUpdating, lifecycleStageNames, optimisticStageIndex]);

    const handleRegressStage = useCallback(() => {
        void moveStage(-1);
    }, [moveStage]);

    const handleAdvanceStage = useCallback(() => {
        void moveStage(1);
    }, [moveStage]);

    const filesSyncStatus = extendedProject?.syncStatus;
    const filesSyncBadge = useFilesWorkspaceStore((s) => s.byProjectId[project.id]?.git?.syncBadge ?? null);
    const initialTaskDrawerId = searchParams?.get('drawerType') === 'task' ? searchParams.get('drawerId') : null;
    const initialTaskPanelTabParam = searchParams?.get('panelTab');
    const initialTaskPanelTab = initialTaskPanelTabParam === 'details' || initialTaskPanelTabParam === 'subtasks' || initialTaskPanelTabParam === 'comments' || initialTaskPanelTabParam === 'files' ? (initialTaskPanelTabParam as TaskPanelTab) : null;
    const initialOpenFileId = searchParams?.get('fileId') || null;
    const initialOpenPath = searchParams?.get('path') || null;

    // Memoize the Files tab while active so parent shell updates do not churn the workspace.
    const filesTabContent = useMemo(
        () => (
            <TabErrorBoundary tabName="Files" fillContainer>
                <FilesTab key={`${project.id}:${currentUserId ?? 'viewer'}`} projectId={project.id} projectSlug={project.slug || undefined} projectName={project.title} currentUserId={currentUserId || undefined} isOwner={isOwner} isOwnerOrMember={isOwnerOrMember} canManageFiles={canManageFiles} canUploadFiles={canUploadFiles} canReadTasks={canReadTaskFiles} isActive={activeTab === 'files'} syncStatus={filesSyncStatus} initialOpenFileId={initialOpenFileId} initialOpenPath={initialOpenPath} />
            </TabErrorBoundary>
        ),
        [project.id, project.slug, project.title, currentUserId, isOwner, isOwnerOrMember, canManageFiles, canUploadFiles, canReadTaskFiles, activeTab, filesSyncStatus, initialOpenFileId, initialOpenPath],
    );

    if (!project) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <ProjectLayout project={projectWithLiveStats} isOwner={isOwner} canManageSettings={canManageProjectSettings} isOwnerOrMember={isOwnerOrMember} publicTabVisibility={publicTabVisibility} activeTab={activeTab} isDocEditing={isDocEditing} onTabChange={handleTabChange} followersCount={followersCount} viewCount={viewCount} filesSyncBadge={filesSyncBadge} isFollowing={isFollowing} onFollow={handleFollow} followLoading={followLoading} onShare={handleShare} onTabHover={handleTabHover}>
            {activeTab === 'dashboard' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Dashboard">
                        <DashboardTab project={projectWithLiveStats} isCreator={isOwner} isCollaborator={isMember} canManageTeam={canManageProjectSettings} members={members} loadingMembers={loadingMembers} rolesWithFilled={rolesWithFilled} onEdit={handleEdit} onAdvanceStage={handleAdvanceStage} onRedoStage={handleRegressStage} onApplyToRole={handleApplyToRole} onManageTeam={() => setIsInviteModalOpen(true)} lifecycleStages={lifecycleStages} currentStageIndex={optimisticStageIndex} applicationStatus={applicationStatus} onAcceptInvitation={() => void handleInvitation('accept')} onDeclineInvitation={() => void handleInvitation('decline')} invitationLoading={invitationLoading} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'readme' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Docs" fillContainer>
                        <DocTab projectId={project.id} project={projectWithLiveStats} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'updates' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Updates">
                        <UpdatesTab projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} currentUserId={currentUserId} currentUserName={currentUserName} currentUserAvatarUrl={currentUserAvatarUrl} canCreateUpdates={canCreateUpdates} canManageUpdates={canManageUpdates} initialUpdateId={searchParams?.get('updateId') || null} initialCommentId={searchParams?.get('commentId') || null} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'sprints' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Sprints">
                        <div className="space-y-6">
                            <SprintPlanning projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} projectKey={project.key} isOwner={isOwner} isOwnerOrMember={isOwnerOrMember} initialSprintData={initialSprintData} />
                        </div>
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'tasks' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Tasks">
                        <TasksTab projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} currentUserId={currentUserId || undefined} isOwner={isOwner} canEditTasks={canEditTasks} canManageFiles={canManageFiles} canManageWorkflow={canManageProjectSettings} initialTasks={tasks} members={allMembers} sprints={sprints} initialOpenTaskId={initialTaskDrawerId ?? workspaceInitialTaskId} initialPanelTab={initialTaskPanelTab} initialCommentId={searchParams?.get('commentId')} initialFileId={searchParams?.get('fileId')} onInitialTaskOpened={workspaceInitialTaskId ? consumeWorkspaceTaskHandoff : undefined} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'analytics' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Analytics">
                        <AnalyticsTab projectId={project.id} project={projectWithLiveStats} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'files' && (
                <div className="w-full h-full min-h-0">
                    {filesTabContent}
                </div>
            )}

            {canManageProjectSettings && activeTab === 'settings' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Settings">
                        <ProjectSettingsTab projectId={project.id} project={project} onProjectUpdated={handleProjectSettingsUpdated} isProjectOwner={isOwner} actorRole={currentProjectRole} members={allMembers} loadingMembers={loadingMembers} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'privacy' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Privacy & terms">
                        <ProjectPrivacyTermsTab
                            project={projectWithLiveStats}
                            isOwner={isOwner}
                            isOwnerOrMember={isOwnerOrMember}
                            publicTabVisibility={publicTabVisibility}
                        />
                    </TabErrorBoundary>
                </div>
            )}

            {isOnboardingOpen ? (
                <ProjectOnboardingModal
                    isOpen={isOnboardingOpen}
                    onClose={() => setIsOnboardingOpen(false)}
                    projectTitle={project.title}
                    roleTitle={isMember ? 'Team Member' : undefined} // Ideally pass role from DB
                    onViewTasks={() => {
                        setIsOnboardingOpen(false);
                        handleTabChange('tasks');
                    }}
                    onViewDocs={() => {
                        setIsOnboardingOpen(false);
                        handleTabChange('files');
                    }}
                />
            ) : null}

            {isEditModalOpen ? <EditProjectModal project={extendedProject} isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} onSaved={() => refreshProjectData()} /> : null}

            {isApplyModalOpen && rolesWithFilled.length > 0 && (
                <ApplyRoleModal
                    isOpen={isApplyModalOpen}
                    onClose={() => {
                        setIsApplyModalOpen(false);
                        setPreselectedRoleId(undefined);
                    }}
                    project={{
                        id: project.id,
                        title: project.title,
                        slug: project.slug,
                    }}
                    roles={rolesWithFilled}
                    preselectedRoleId={preselectedRoleId}
                    onSuccess={() => refreshProjectData()}
                />
            )}

            {isInviteModalOpen && (
                <InviteCollaboratorModal
                    isOpen={isInviteModalOpen}
                    onClose={() => {
                        setIsInviteModalOpen(false);
                        refreshProjectData();
                    }}
                    projectId={project.id}
                    projectTitle={project.title}
                    canAppointGuidance={isOwner}
                />
            )}
        </ProjectLayout>
    );
}
