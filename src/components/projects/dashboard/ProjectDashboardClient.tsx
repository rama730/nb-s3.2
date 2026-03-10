"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import ProjectLayout from "@/components/projects/dashboard/ProjectLayout";
import { TabErrorBoundary } from "@/components/projects/TabErrorBoundary";
import { ProjectIntelligenceProvider } from "@/components/projects/intelligence/ProjectIntelligenceProvider";
import type { Project } from "@/types/hub";
import { toggleProjectFollowAction, startSprintAction, completeSprintAction, moveTaskToSprintAction, updateProjectStageAction, incrementProjectViewAction } from "@/app/actions/project";
import { getApplicationStatusAction } from "@/app/actions/applications";
import ApplicationStatusBanner from "@/components/projects/ApplicationStatusBanner";
import { useProjectMembers } from "@/hooks/hub/useProjectData";
import { filesFeatureFlags } from "@/lib/features/files";
import { getProjectNodes } from "@/app/actions/files";
import { queryKeys } from "@/lib/query-keys";
import { logger } from "@/lib/logger";

import { 
    DashboardTab, 
    TasksTab, 
    FilesTab, 
    AnalyticsTab, 
    SprintPlanning, 
    ProjectSettingsTab 
} from "@/components/projects/dashboard/ProjectTabsRegistry";

const EditProjectModal = dynamic(
    () => import("@/components/projects/EditProjectModal"),
    { ssr: false }
);

const ApplyRoleModal = dynamic(
    () => import("@/components/projects/ApplyRoleModal"),
    { ssr: false }
);

const ProjectOnboardingModal = dynamic(
    () => import("@/components/projects/ProjectOnboardingModal").then(mod => mod.ProjectOnboardingModal),
    { ssr: false }
);

interface ProjectDashboardClientProps {
    project: Project;
    currentUserId: string | null;
    isOwner: boolean;
    isMember: boolean;
}

export default function ProjectDashboardClient({
    project,
    currentUserId,
    isOwner,
    isMember,
}: ProjectDashboardClientProps) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const params = useParams();
    const searchParams = useSearchParams();

    const invalidateProjectDetailSlices = useCallback((options?: {
        shell?: boolean;
        shellRefresh?: boolean;
        tasks?: boolean;
        sprints?: boolean;
        analytics?: boolean;
        members?: boolean;
        files?: boolean;
    }) => {
        const o = options ?? {};
        if (o.shell) {
            if (project.slug) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.project.bySlug(project.slug) });
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.byId(project.id) });
            if (o.shellRefresh) {
                router.refresh();
            }
        }
        if (o.tasks) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(project.id) });
        }
        if (o.sprints) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprints(project.id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintTasksRoot(project.id) });
        }
        if (o.analytics) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.analytics(project.id) });
        }
        if (o.members) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.members(project.id) });
        }
        if (o.files) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.filesNodes(project.id, null) });
        }
    }, [project.id, project.slug, queryClient, router]);

    const refreshProjectData = useCallback(() => {
        invalidateProjectDetailSlices({
            shell: true,
            tasks: true,
            sprints: true,
            analytics: true,
            members: true,
            files: true,
        });
    }, [invalidateProjectDetailSlices]);

    // Active tab from URL or default
    const [activeTab, setActiveTab] = useState(() => {
        return searchParams?.get("tab") || "dashboard";
    });
    const [hasMountedFilesTab, setHasMountedFilesTab] = useState(
        () => (searchParams?.get("tab") || "dashboard") === "files"
    );

    // State management
    const [isFollowing, setIsFollowing] = useState((project as any).isFollowed || false);
    const [followLoading, setFollowLoading] = useState(false);
    const [followersCount, setFollowersCount] = useState((project as any).followersCount || 0);
    const [viewCount, setViewCount] = useState((project as any).viewCount || 0);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
    const [preselectedRoleId, setPreselectedRoleId] = useState<string | undefined>(undefined);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isStageUpdating, setIsStageUpdating] = useState(false);
    const [stageVersion, setStageVersion] = useState<string | null>((project as any).updatedAt || null);
    const isMountedRef = useRef(true);
    const followRequestRef = useRef(0);
    const followInFlightRef = useRef(false);
    const shareRequestRef = useRef(0);
    const viewRequestRef = useRef(0);
    const stageRequestRef = useRef(0);
    const sprintMutationRequestRef = useRef(0);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

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

    // Application status for non-owner/non-member users
    const [applicationStatus, setApplicationStatus] = useState<{
        status: 'none' | 'pending' | 'accepted' | 'rejected';
        roleTitle?: string;
        decisionReason?: string | null;
        lifecycleStatus?: 'none' | 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'role_filled';
        canReapply?: boolean;
        waitTime?: string;
    }>({ status: 'none' });

    // Optimistic State for Project Journey
    const [optimisticStageIndex, setOptimisticStageIndex] = useState((project as any).currentStageIndex || 0);

    // Sync state with server updates (e.g. revalidation or external changes)
    // This ensures we don't get stuck in a detached state if the server updates
    const serverStageIndex = (project as any).currentStageIndex || 0;
    const serverProjectUpdatedAt = (project as any).updatedAt || null;
    useEffect(() => {
        setOptimisticStageIndex(serverStageIndex);
    }, [serverStageIndex]);

    // Derived state
    const isOwnerOrMember = isOwner || isMember;

    // Extended project data (may come from joined queries, cast to any for flexibility)
    const projectWithLiveStats = useMemo(() => ({
        ...(project as any),
        viewCount,
        followersCount,
    }), [project, viewCount, followersCount]);
    const extendedProject = projectWithLiveStats as any;

    const lastProjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!project?.id) return;
        if (lastProjectIdRef.current === project.id) return;
        lastProjectIdRef.current = project.id;
        setFollowersCount((project as any).followersCount || 0);
        setViewCount((project as any).viewCount || 0);
        setIsFollowing((project as any).isFollowed || false);
        setStageVersion(serverProjectUpdatedAt);
    }, [project?.id, serverProjectUpdatedAt]);

    // OPTIMIZATION: Default to empty arrays as these are now fetched client-side or lazy loaded
    const tasks = useMemo(() => extendedProject?.tasks || [], [extendedProject]);
    const files = useMemo(() => extendedProject?.files || [], [extendedProject]);
    const initialFileNodes = useMemo(() => extendedProject?.initialFileNodes || [], [extendedProject]);
    const sprints = useMemo(() => extendedProject?.sprints || [], [extendedProject]);

    const collaboratorUsers = useMemo(() => {
        const list = (extendedProject?.collaborators || []) as any[];
        return list
            .map((c) => (c?.user ? {
                ...c.user,
                membershipRole: c.membershipRole,
                projectRoleTitle: c.projectRoleTitle ?? null,
                joinedAt: c.joinedAt ?? null,
            } : null))
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
        if (rolesWithFilled.length === 0) return;

        getApplicationStatusAction(project.id).then(setApplicationStatus);
    }, [project.id, currentUserId, isOwner, isMember, rolesWithFilled.length]);

    // Hook Integration: Scalable Member Loading
    const shouldLoadMembers =
        activeTab === "dashboard" ||
        activeTab === "tasks" ||
        activeTab === "sprints";

    const { 
        data: membersData, 
        isLoading: loadingMembers,
        fetchNextPage: fetchNextMembers,
        hasNextPage: hasNextMembers
    } = useProjectMembers(project.id, collaboratorUsers || [], {
        enabled: shouldLoadMembers,
        initialHasMore: (project as any)?.membersHasMore,
        initialCursor: (project as any)?.membersNextCursor,
        pageSize: 20,
    });

    // Flatten members and include owner
    const allMembers = useMemo(() => {
        const collab = membersData?.pages.flatMap((p: any) => p.members) || collaboratorUsers || [];
        const owner = extendedProject?.owner || (project as any)?.owner;
        
        const list = [...collab];
        if (owner && !list.find(m => m.id === owner.id)) {
            list.unshift(owner);
        }
        return list;
    }, [membersData, collaboratorUsers, project, extendedProject]);

    // Current members
    const members = useMemo(() => {
        return membersData?.pages.flatMap((p: any) => p.members) || collaboratorUsers || [];
    }, [membersData, collaboratorUsers]);

    const lifecycleStageNames = useMemo(() => {
        return (
            Array.isArray(extendedProject?.lifecycleStages) && extendedProject.lifecycleStages.length > 0
                ? extendedProject.lifecycleStages
                : Array.isArray((extendedProject as any)?.lifecycle_stages) && (extendedProject as any).lifecycle_stages.length > 0
                    ? (extendedProject as any).lifecycle_stages
                    : []
        ) as string[];
    }, [extendedProject]);

    const lifecycleStages = useMemo(() => {
        const stages = lifecycleStageNames;
        const currentIndex = optimisticStageIndex;
        return stages.map((stageName: string, idx: number) => ({
            name: stageName,
            status: idx < currentIndex ? "completed" : idx === currentIndex ? "current" : "upcoming",
        }));
    }, [lifecycleStageNames, optimisticStageIndex]);

    // Tab change handler
    const handleTabChange = useCallback((tabId: string) => {
        if (tabId === activeTab) return;
        setActiveTab(tabId);
        // Update URL without reload
        const params = new URLSearchParams(window.location.search);
        params.set("tab", tabId);
        router.replace(`?${params.toString()}`, { scroll: false });
    }, [activeTab, router]);

    const filesPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const filesPrefetchQueryKey = useMemo(
        () => queryKeys.project.detail.filesNodes(project.id, null),
        [project.id]
    );

    const handleTabHover = useCallback((tabId: string) => {
        if (!(filesFeatureFlags.prefetchHover || filesFeatureFlags.wave2PrefetchHover)) return;
        if (tabId !== "files") return;
        if (filesPrefetchTimerRef.current) {
            clearTimeout(filesPrefetchTimerRef.current);
            filesPrefetchTimerRef.current = null;
        }
        filesPrefetchTimerRef.current = setTimeout(() => {
            const queryState = queryClient.getQueryState(filesPrefetchQueryKey);
            const isFresh =
                !!queryState?.dataUpdatedAt && Date.now() - queryState.dataUpdatedAt < 60_000;
            if (isFresh) return;
            void import("@/components/projects/v2/ProjectFilesWorkspace");
            queryClient.prefetchQuery({
                queryKey: filesPrefetchQueryKey,
                queryFn: () => getProjectNodes(project.id, null),
                staleTime: 60_000,
            });
        }, 120);
    }, [filesPrefetchQueryKey, project.id, queryClient]);

    const handleTabLeave = useCallback((tabId: string) => {
        if (tabId !== "files") return;
        if (filesPrefetchTimerRef.current) {
            clearTimeout(filesPrefetchTimerRef.current);
            filesPrefetchTimerRef.current = null;
        }
        void queryClient.cancelQueries({ queryKey: filesPrefetchQueryKey });
    }, [filesPrefetchQueryKey, queryClient]);

    useEffect(() => {
        return () => {
            if (filesPrefetchTimerRef.current) {
                clearTimeout(filesPrefetchTimerRef.current);
                filesPrefetchTimerRef.current = null;
            }
        };
    }, []);

    // Actions
    const handleEdit = useCallback((section?: string) => {
        setIsEditModalOpen(true);
        // Optional: Could pre-select tab based on section
    }, []);

    const handleShare = useCallback(async () => {
        const requestId = ++shareRequestRef.current;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
                await navigator.share({
                    title: project.title,
                    url: window.location.href,
                });
                if (!isMountedRef.current || requestId !== shareRequestRef.current) return;
                toast.success("Share sheet opened");
                logger.metric("project.detail.share.result", {
                    projectId: project.id,
                    mode: "native-share",
                    success: true,
                });
                return;
            }
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(window.location.href);
                if (!isMountedRef.current || requestId !== shareRequestRef.current) return;
                toast.success("Link copied to clipboard");
                logger.metric("project.detail.share.result", {
                    projectId: project.id,
                    mode: "clipboard",
                    success: true,
                });
                return;
            }
            throw new Error("Sharing is unavailable in this browser");
        } catch (error) {
            if (!isMountedRef.current || requestId !== shareRequestRef.current) return;
            const isAbort = error instanceof Error && error.name === "AbortError";
            if (isAbort) return;
            const message = error instanceof Error ? error.message : "Failed to share project link";
            toast.error(message);
            logger.metric("project.detail.share.result", {
                projectId: project.id,
                success: false,
                message,
            });
        }
    }, [project.id, project.title]);

    const handleFollow = useCallback(async () => {
        if (followLoading || followInFlightRef.current) return;
        if (!currentUserId) {
            toast.error("Please log in to follow projects");
            return;
        }
        // Optimistic update
        const requestId = ++followRequestRef.current;
        const baselineFollowersCount = followersCount;
        const newIsFollowing = !isFollowing;
        setIsFollowing(newIsFollowing);
        setFollowersCount((c: number) => newIsFollowing ? c + 1 : Math.max(0, c - 1));

        try {
            setFollowLoading(true);
            followInFlightRef.current = true;
            const result = await toggleProjectFollowAction(project.id, newIsFollowing);
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            if (!result.success) throw new Error(result.error);
            if (result.followersCount !== undefined) {
                const serverCount = Math.max(0, result.followersCount);
                const reconciledCount = newIsFollowing
                    ? Math.max(serverCount, baselineFollowersCount + 1)
                    : Math.min(serverCount, Math.max(0, baselineFollowersCount - 1));
                setFollowersCount(reconciledCount);
            }
            toast.success(newIsFollowing ? "Following project" : "Unfollowed project");
            logger.metric("project.detail.follow.result", {
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
            const message = error instanceof Error ? error.message : "Failed to update follow status";
            toast.error(message);
            logger.metric("project.detail.follow.result", {
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
        if (typeof window === "undefined") return;
        const viewKey = `project_viewed:${project.id}`;
        if (sessionStorage.getItem(viewKey)) return;
        sessionStorage.setItem(viewKey, "1");
        const requestId = ++viewRequestRef.current;
        incrementProjectViewAction(project.id).then((result) => {
            if (!isMountedRef.current || requestId !== viewRequestRef.current) return;
            const nextViewCount = result.viewCount;
            if (result.success && typeof nextViewCount === "number") {
                setViewCount((current: number) => Math.max(current, nextViewCount));
                logger.metric("project.detail.view.increment", {
                    projectId: project.id,
                    success: true,
                    viewCount: nextViewCount,
                });
            } else {
                logger.metric("project.detail.view.increment", {
                    projectId: project.id,
                    success: false,
                    message: result.error || "increment failed",
                });
            }
        });
    }, [project?.id]);

    const handleApplyToRole = useCallback((role: any) => {
        if (!currentUserId) {
            toast.error("Please log in to apply");
            return;
        }

        // Check if user has an existing application that blocks re-application
        if (applicationStatus.status === 'pending') {
            toast.error("You already have a pending application");
            return;
        }

        if (applicationStatus.status === 'rejected' && !applicationStatus.canReapply) {
            toast.error(`You can reapply in ${applicationStatus.waitTime}`);
            return;
        }

        // Open the apply modal, optionally with a preselected role
        setPreselectedRoleId(role?.id || undefined);
        setIsApplyModalOpen(true);
    }, [currentUserId, applicationStatus]);

    const commitStageIndex = useCallback(async (
        targetIndex: number,
        expectedUpdatedAt: string | null,
        allowRetry = true
    ): Promise<boolean> => {
        const requestId = ++stageRequestRef.current;
        setIsStageUpdating(true);
        try {
            const result = await updateProjectStageAction(project.id, targetIndex, {
                expectedUpdatedAt: expectedUpdatedAt || undefined,
            });

            if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;

            if (result.success) {
                const nextIndex = typeof result.currentStageIndex === "number" ? result.currentStageIndex : targetIndex;
                setOptimisticStageIndex(nextIndex);
                setStageVersion(result.updatedAt ?? null);
                return true;
            }

            if (result.errorCode === "PROJECT_CONFLICT" && allowRetry && result.latest) {
                const latestIndex = Math.max(0, result.latest.currentStageIndex ?? 0);
                const latestVersion = result.latest.updatedAt ?? null;
                setOptimisticStageIndex(latestIndex);
                setStageVersion(latestVersion);

                if (latestIndex >= targetIndex) {
                    toast.info("Stage updated from another session. Synced latest stage.");
                    return true;
                }

                const retryTarget = Math.min(Math.max(0, lifecycleStageNames.length - 1), latestIndex + 1);
                const retryResult = await updateProjectStageAction(project.id, retryTarget, {
                    expectedUpdatedAt: latestVersion || undefined,
                });

                if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;

                if (retryResult.success) {
                    const nextIndex = typeof retryResult.currentStageIndex === "number"
                        ? retryResult.currentStageIndex
                        : retryTarget;
                    setOptimisticStageIndex(nextIndex);
                    setStageVersion(retryResult.updatedAt ?? latestVersion);
                    return true;
                }

                toast.error(retryResult.error || "Failed to update stage after sync");
                return false;
            }

            toast.error(result.error || "Failed to update stage");
            return false;
        } catch (error) {
            if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;
            toast.error(error instanceof Error ? error.message : "Failed to update project stage");
            return false;
        } finally {
            if (isMountedRef.current && requestId === stageRequestRef.current) {
                setIsStageUpdating(false);
            }
        }
    }, [lifecycleStageNames.length, project.id]);

    const handleUndoStage = useCallback(async (prevIndex: number) => {
        if (isStageUpdating) return;
        const rollbackIndex = optimisticStageIndex;
        setOptimisticStageIndex(prevIndex);
        const committed = await commitStageIndex(prevIndex, stageVersion, true);
        if (!committed) {
            setOptimisticStageIndex(rollbackIndex);
            return;
        }
        toast.success("Undid stage advancement");
    }, [commitStageIndex, isStageUpdating, optimisticStageIndex, stageVersion]);

    const handleAdvanceStage = useCallback(async () => {
        if (isStageUpdating) {
            toast.info("Stage update is in progress");
            return;
        }
        if (!isOwner) {
            toast.error("Only the project owner can advance the stage");
            return;
        }

        const stages = lifecycleStageNames;
        if (optimisticStageIndex >= stages.length - 1) {
            toast.info("Project is already at the final stage");
            return;
        }

        const prevIndex = optimisticStageIndex;
        const nextIndex = prevIndex + 1;
        const nextStageName = stages[nextIndex];

        // 1. Optimistic Update
        setOptimisticStageIndex(nextIndex);
        
        // 2. Show Toast with Undo
        toast.success(`Advanced to ${nextStageName}`, {
            action: {
                label: "Undo",
                onClick: () => handleUndoStage(prevIndex),
            },
            duration: 4000,
        });

        // 3. Server Action
        const committed = await commitStageIndex(nextIndex, stageVersion, true);
        if (!committed) {
            // Revert on failure
            setOptimisticStageIndex(prevIndex);
        }
    }, [isOwner, isStageUpdating, lifecycleStageNames, optimisticStageIndex, commitStageIndex, stageVersion, handleUndoStage]);

    const filesSyncStatus = extendedProject?.syncStatus;
    const filesImportSourceType = extendedProject?.importSource?.type || null;
    const initialOpenPath = searchParams?.get("path") || null;
    const initialOpenLineRaw = Number(searchParams?.get("line") || "");
    const initialOpenColumnRaw = Number(searchParams?.get("column") || "");
    const initialOpenLine = Number.isFinite(initialOpenLineRaw) ? initialOpenLineRaw : null;
    const initialOpenColumn = Number.isFinite(initialOpenColumnRaw) ? initialOpenColumnRaw : null;

    useEffect(() => {
        if (activeTab === "files") {
            setHasMountedFilesTab(true);
        }
    }, [activeTab]);

    // Memoize the Files tab to prevent unmounting/remounting on parent re-renders (e.g. scroll)
    const filesTabContent = useMemo(() => (
        <TabErrorBoundary tabName="Files" fillContainer>
            <FilesTab
                projectId={project.id}
                projectName={project.title}
                currentUserId={currentUserId || undefined}
                isOwnerOrMember={isOwnerOrMember}
                initialFileNodes={initialFileNodes}
                syncStatus={filesSyncStatus}
                importSourceType={filesImportSourceType}
                initialOpenPath={initialOpenPath}
                initialOpenLine={initialOpenLine}
                initialOpenColumn={initialOpenColumn}
            />
        </TabErrorBoundary>
    ), [
        project.id,
        project.title,
        currentUserId,
        isOwnerOrMember,
        initialFileNodes,
        filesSyncStatus,
        filesImportSourceType,
        initialOpenPath,
        initialOpenLine,
        initialOpenColumn,
    ]);

    // Render active tab content
    const renderTabContent = () => {
        switch (activeTab) {
            case "dashboard":
                return (
                    <TabErrorBoundary tabName="Dashboard">
                        <DashboardTab
                            project={projectWithLiveStats}
                            isCreator={isOwner}
                            isOwnerOrMember={isOwnerOrMember}
                            isCollaborator={isMember}
                            currentUserId={currentUserId}
                            tasks={tasks}
                            dashboardTasks={tasks.slice(0, 10)}
                            files={files}
                            members={members}
                            hasNextMembers={hasNextMembers}
                            fetchNextMembers={fetchNextMembers}
                            loadingMembers={loadingMembers}
                            rolesWithFilled={rolesWithFilled}
                            projectActivityEvents={[]}
                            onEdit={handleEdit}
                            onShare={handleShare}
                            onAdvanceStage={handleAdvanceStage}
                            onApplyToRole={handleApplyToRole}
                            onManageTeam={() => handleEdit("team")}
                            onViewBoard={() => handleTabChange("tasks")}
                            onUploadFile={() => handleTabChange("files")}
                            onViewAnalytics={() => handleTabChange("analytics")}
                            onViewSprints={() => handleTabChange("sprints")}
                            onViewSettings={() => handleTabChange("settings")}
                            onTaskClick={(taskId) => router.push(`/projects/${project.id}/tasks/${taskId}`)}
                            lifecycleStages={lifecycleStages}
                            currentStageIndex={optimisticStageIndex}
                            applicationStatus={applicationStatus}
                        />
                    </TabErrorBoundary>
                );

            case "sprints":
                return (
                    <TabErrorBoundary tabName="Sprints">
                        <div className="space-y-6">
                            <SprintPlanning
                                projectId={project.id}
                                isOwnerOrMember={isOwnerOrMember}
                                sprints={sprints}
                                tasks={tasks}
                                onCreateSprint={() => {
                                    toast.success("Sprint created successfully");
                                    invalidateProjectDetailSlices({
                                        sprints: true,
                                        tasks: true,
                                        analytics: true,
                                    });
                                }}
                                onStartSprint={async (id) => {
                                    const requestId = ++sprintMutationRequestRef.current;
                                    try {
                                        const result = await startSprintAction(id, project.id);
                                        if (!isMountedRef.current || requestId !== sprintMutationRequestRef.current) return;
                                        if (result.success) {
                                            toast.success("Sprint started");
                                            invalidateProjectDetailSlices({
                                                sprints: true,
                                                tasks: true,
                                                analytics: true,
                                            });
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        if (!isMountedRef.current || requestId !== sprintMutationRequestRef.current) return;
                                        toast.error("Failed to start sprint");
                                    }
                                }}
                                onCompleteSprint={async (id) => {
                                    const requestId = ++sprintMutationRequestRef.current;
                                    try {
                                        const result = await completeSprintAction(id, project.id);
                                        if (!isMountedRef.current || requestId !== sprintMutationRequestRef.current) return;
                                        if (result.success) {
                                            toast.success("Sprint completed");
                                            invalidateProjectDetailSlices({
                                                sprints: true,
                                                tasks: true,
                                                analytics: true,
                                            });
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        if (!isMountedRef.current || requestId !== sprintMutationRequestRef.current) return;
                                        toast.error("Failed to complete sprint");
                                    }
                                }}
                                onMoveTask={async (taskId, sprintId) => {
                                    const requestId = ++sprintMutationRequestRef.current;
                                    try {
                                        const result = await moveTaskToSprintAction(taskId, sprintId, project.id);
                                        if (!isMountedRef.current || requestId !== sprintMutationRequestRef.current) return;
                                        if (result.success) {
                                            toast.success("Task moved");
                                            invalidateProjectDetailSlices({
                                                sprints: true,
                                                tasks: true,
                                                analytics: true,
                                            });
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        if (!isMountedRef.current || requestId !== sprintMutationRequestRef.current) return;
                                        toast.error("Failed to move task");
                                    }
                                }}
                            />
                        </div>
                    </TabErrorBoundary>
                );

            case "tasks":
                return (
                    <TabErrorBoundary tabName="Tasks">
                        <TasksTab
                            projectId={project.id}
                            projectName={project.title}
                            currentUserId={currentUserId || undefined}
                            isOwner={isOwner}
                            isOwnerOrMember={isOwnerOrMember}
                            projectCreatorId={(project as any).ownerId}
                            initialTasks={tasks}
                            totalCount={tasks.length}
                            members={allMembers}
                            sprints={sprints}
                        />
                    </TabErrorBoundary>
                );

            case "analytics":
                return (
                    <TabErrorBoundary tabName="Analytics">
                        <AnalyticsTab projectId={project.id} project={projectWithLiveStats} />
                    </TabErrorBoundary>
                );

            case "files":
                return null;

            case "settings":
                if (!isOwner) return null;
                return (
                    <TabErrorBoundary tabName="Settings">
                        <ProjectSettingsTab
                            projectId={project.id}
                            project={project}
                            onProjectUpdated={() => refreshProjectData()}
                            isProjectOwner={isOwner}
                        />
                    </TabErrorBoundary>
                );

            default:
                return null;
        }
    };

    if (!project) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <ProjectIntelligenceProvider>
            <ProjectLayout
                project={projectWithLiveStats}
                isOwner={isOwner}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                followersCount={followersCount}
                viewCount={viewCount}
                onEdit={() => handleEdit()}
                isFollowing={isFollowing}
                onFollow={handleFollow}
                followLoading={followLoading}
                onShare={handleShare}
                onTabHover={handleTabHover}
                onTabLeave={handleTabLeave}
            >
                {/* Application Status Banner for visitors */}
                {!isOwner && !isMember && currentUserId && rolesWithFilled.length > 0 && (
                    <div className="mb-6">
                        <ApplicationStatusBanner
                            status={applicationStatus.status}
                            lifecycleStatus={applicationStatus.lifecycleStatus}
                            decisionReason={applicationStatus.decisionReason}
                            roleTitle={applicationStatus.roleTitle}
                            canReapply={applicationStatus.canReapply}
                            waitTime={applicationStatus.waitTime}
                            onApply={() => setIsApplyModalOpen(true)}
                            isOwner={isOwner}
                            isMember={isMember}
                        />
                    </div>
                )}
                
                {activeTab === "files" ? filesTabContent : renderTabContent()}
                {hasMountedFilesTab && activeTab !== "files" ? (
                    <div className="hidden">{filesTabContent}</div>
                ) : null}

                <ProjectOnboardingModal
                    isOpen={isOnboardingOpen}
                    onClose={() => setIsOnboardingOpen(false)}
                    projectTitle={project.title}
                    roleTitle={isMember ? "Team Member" : undefined} // Ideally pass role from DB
                    onViewTasks={() => {
                        setIsOnboardingOpen(false);
                        handleTabChange("tasks");
                    }}
                    onViewDocs={() => {
                        setIsOnboardingOpen(false);
                        handleTabChange("files");
                    }}
                />
                
                <EditProjectModal 
                    project={extendedProject}
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    onSaved={() => refreshProjectData()}
                />
                
                {rolesWithFilled.length > 0 && (
                    <ApplyRoleModal
                        isOpen={isApplyModalOpen}
                        onClose={() => {
                            setIsApplyModalOpen(false);
                            setPreselectedRoleId(undefined);
                        }}
                        project={{
                            id: project.id,
                            title: project.title,
                            slug: project.slug
                        }}
                        roles={rolesWithFilled}
                        preselectedRoleId={preselectedRoleId}
                        onSuccess={() => refreshProjectData()}
                    />
                )}
            </ProjectLayout>
        </ProjectIntelligenceProvider>
    );
}
