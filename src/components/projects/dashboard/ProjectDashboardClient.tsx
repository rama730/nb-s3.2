"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import ProjectLayout from "@/components/projects/dashboard/ProjectLayout";
import { TabErrorBoundary } from "@/components/projects/TabErrorBoundary";
import { ProjectIntelligenceProvider } from "@/components/projects/intelligence/ProjectIntelligenceProvider";
import type { Project } from "@/types/hub";
import { toggleProjectBookmarkAction, toggleProjectFollowAction, startSprintAction, completeSprintAction, moveTaskToSprintAction, updateProjectStageAction, incrementProjectViewAction } from "@/app/actions/project";
import { getApplicationStatusAction } from "@/app/actions/applications";
import ApplicationStatusBanner from "@/components/projects/ApplicationStatusBanner";
import { useProjectMembers } from "@/hooks/hub/useProjectData";

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
    const params = useParams();
    const searchParams = useSearchParams();

    // Active tab from URL or default
    const [activeTab, setActiveTab] = useState(() => {
        return searchParams?.get("tab") || "dashboard";
    });

    // State management
    const [isBookmarked, setIsBookmarked] = useState((project as any).isSaved || false);
    const [isFollowing, setIsFollowing] = useState((project as any).isFollowed || false);
    const [bookmarkLoading, setBookmarkLoading] = useState(false);
    const [followLoading, setFollowLoading] = useState(false);
    const [followersCount, setFollowersCount] = useState((project as any).followersCount || 0);
    const [viewCount, setViewCount] = useState((project as any).viewCount || 0);
    const [savesCount, setSavesCount] = useState((project as any).savesCount || 0);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
    const [preselectedRoleId, setPreselectedRoleId] = useState<string | undefined>(undefined);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

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
        canReapply?: boolean;
        waitTime?: string;
    }>({ status: 'none' });

    // Optimistic State for Project Journey
    const [optimisticStageIndex, setOptimisticStageIndex] = useState((project as any).currentStageIndex || 0);

    // Sync state with server updates (e.g. revalidation or external changes)
    // This ensures we don't get stuck in a detached state if the server updates
    const serverStageIndex = (project as any).currentStageIndex || 0;
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
        savesCount,
    }), [project, viewCount, followersCount, savesCount]);
    const extendedProject = projectWithLiveStats as any;

    const lastProjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!project?.id) return;
        if (lastProjectIdRef.current === project.id) return;
        lastProjectIdRef.current = project.id;
        setFollowersCount((project as any).followersCount || 0);
        setViewCount((project as any).viewCount || 0);
        setSavesCount((project as any).savesCount || 0);
        setIsFollowing((project as any).isFollowed || false);
        setIsBookmarked((project as any).isSaved || false);
    }, [project?.id]);

    // OPTIMIZATION: Default to empty arrays as these are now fetched client-side or lazy loaded
    const tasks = useMemo(() => extendedProject?.tasks || [], [extendedProject]);
    const files = useMemo(() => extendedProject?.files || [], [extendedProject]);
    const initialFileNodes = useMemo(() => extendedProject?.initialFileNodes || [], [extendedProject]);
    const sprints = useMemo(() => extendedProject?.sprints || [], [extendedProject]);

    const collaboratorUsers = useMemo(() => {
        const list = (extendedProject?.collaborators || []) as any[];
        return list
            .map((c) => (c?.user ? { ...c.user, membershipRole: c.membershipRole } : null))
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

    const lifecycleStages = useMemo(() => {
        const stages = (
            Array.isArray(extendedProject?.lifecycleStages) && extendedProject.lifecycleStages.length > 0
                ? extendedProject.lifecycleStages
                : Array.isArray((extendedProject as any)?.lifecycle_stages) && (extendedProject as any).lifecycle_stages.length > 0
                    ? (extendedProject as any).lifecycle_stages
                    : []
        ) as string[];
        const currentIndex = optimisticStageIndex;
        return stages.map((stageName: string, idx: number) => ({
            name: stageName,
            status: idx < currentIndex ? "completed" : idx === currentIndex ? "current" : "upcoming",
        }));
    }, [extendedProject, optimisticStageIndex]);

    // Tab change handler
    const handleTabChange = useCallback((tabId: string) => {
        if (tabId === activeTab) return;
        setActiveTab(tabId);
        // Update URL without reload
        const params = new URLSearchParams(window.location.search);
        params.set("tab", tabId);
        router.replace(`?${params.toString()}`, { scroll: false });
    }, [activeTab, router]);

    // Actions
    const handleEdit = useCallback((section?: string) => {
        setIsEditModalOpen(true);
        // Optional: Could pre-select tab based on section
    }, []);

    const handleShare = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            toast.success("Link copied to clipboard");
        } catch {
            toast.error("Failed to copy link");
        }
    }, []);

    const handleBookmark = useCallback(async () => {
        if (bookmarkLoading) return;
        if (!currentUserId) {
            toast.error("Please log in to save projects");
            return;
        }
        setBookmarkLoading(true);
        // Optimistic update
        const newIsBookmarked = !isBookmarked;
        setIsBookmarked(newIsBookmarked);
        setSavesCount((c: number) => newIsBookmarked ? c + 1 : Math.max(0, c - 1));
        
        try {
            const result = await toggleProjectBookmarkAction(project.id, newIsBookmarked);
            if (!result.success) throw new Error(result.error);
            if (result.savesCount !== undefined) {
                setSavesCount(result.savesCount);
            }
            toast.success(newIsBookmarked ? "Saved to collection" : "Removed from saved");
        } catch (error) {
            // Revert on failure
            setIsBookmarked(!newIsBookmarked);
            setSavesCount((c: number) => !newIsBookmarked ? c + 1 : Math.max(0, c - 1));
            toast.error("Failed to update bookmark");
        } finally {
            setBookmarkLoading(false);
        }
    }, [bookmarkLoading, currentUserId, isBookmarked, project.id]);

    const handleFollow = useCallback(async () => {
        if (followLoading) return;
        if (!currentUserId) {
            toast.error("Please log in to follow projects");
            return;
        }
        // Optimistic update
        const newIsFollowing = !isFollowing;
        setIsFollowing(newIsFollowing);
        setFollowersCount((c: number) => newIsFollowing ? c + 1 : Math.max(0, c - 1));

        try {
            setFollowLoading(true);
            const result = await toggleProjectFollowAction(project.id, newIsFollowing);
            if (!result.success) throw new Error(result.error);
            if (result.followersCount !== undefined) {
                setFollowersCount(result.followersCount);
            }
            toast.success(newIsFollowing ? "Following project" : "Unfollowed project");
        } catch (error) {
            // Revert
            setIsFollowing(!newIsFollowing);
            setFollowersCount((c: number) => !newIsFollowing ? c + 1 : Math.max(0, c - 1));
            toast.error("Failed to update follow status");
        } finally {
            setFollowLoading(false);
        }
    }, [currentUserId, followLoading, isFollowing, project.id]);

    useEffect(() => {
        if (!project?.id) return;
        if (typeof window === "undefined") return;
        const viewKey = `project_viewed:${project.id}`;
        if (sessionStorage.getItem(viewKey)) return;
        sessionStorage.setItem(viewKey, "1");
        incrementProjectViewAction(project.id).then((result) => {
            if (result.success && typeof result.viewCount === "number") {
                setViewCount(result.viewCount);
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

    const handleUndoStage = useCallback(async (prevIndex: number) => {
        setOptimisticStageIndex(prevIndex); // Revert optimistic UI
        try {
            await updateProjectStageAction(project.id, prevIndex);
            toast.success("Undid stage advancement");
        } catch (error) {
            toast.error("Failed to undo stage change");
        }
    }, [project.id]);

    const handleAdvanceStage = useCallback(async () => {
        if (!isOwner) {
            toast.error("Only the project owner can advance the stage");
            return;
        }

        const stages = extendedProject?.lifecycleStages || [];
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
        try {
            const result = await updateProjectStageAction(project.id, nextIndex);
            if (!result.success) {
                throw new Error(result.error);
            }
        } catch (error) {
            // Revert on failure
            setOptimisticStageIndex(prevIndex);
            toast.error("Failed to update stage");
        }
    }, [isOwner, optimisticStageIndex, extendedProject, project.id, handleUndoStage]);

    const filesSyncStatus = extendedProject?.syncStatus;
    const filesImportSourceType = extendedProject?.importSource?.type || null;

    // Memoize the Files tab to prevent unmounting/remounting on parent re-renders (e.g. scroll)
    const filesTabContent = useMemo(() => (
        <TabErrorBoundary tabName="Files">
            <FilesTab
                projectId={project.id}
                projectName={project.title}
                currentUserId={currentUserId || undefined}
                isOwnerOrMember={isOwnerOrMember}
                initialFileNodes={initialFileNodes}
                syncStatus={filesSyncStatus}
                importSourceType={filesImportSourceType}
            />
        </TabErrorBoundary>
    ), [project.id, project.title, currentUserId, isOwnerOrMember, initialFileNodes, filesSyncStatus, filesImportSourceType]);

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
                                    router.refresh();
                                }}
                                onStartSprint={async (id) => {
                                    try {
                                        const result = await startSprintAction(id, project.id);
                                        if (result.success) {
                                            toast.success("Sprint started");
                                            router.refresh();
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        toast.error("Failed to start sprint");
                                    }
                                }}
                                onCompleteSprint={async (id) => {
                                    try {
                                        const result = await completeSprintAction(id, project.id);
                                        if (result.success) {
                                            toast.success("Sprint completed");
                                            router.refresh();
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        toast.error("Failed to complete sprint");
                                    }
                                }}
                                onMoveTask={async (taskId, sprintId) => {
                                    try {
                                        const result = await moveTaskToSprintAction(taskId, sprintId, project.id);
                                        if (result.success) {
                                            toast.success("Task moved");
                                            router.refresh();
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
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
                return filesTabContent;

            case "settings":
                if (!isOwner) return null;
                return (
                    <TabErrorBoundary tabName="Settings">
                        <ProjectSettingsTab
                            projectId={project.id}
                            project={project}
                            onProjectUpdated={() => router.refresh()}
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
                savesCount={savesCount}
                onEdit={() => handleEdit()}
                isBookmarked={isBookmarked}
                onBookmark={handleBookmark}
                bookmarkLoading={bookmarkLoading}
                isFollowing={isFollowing}
                onFollow={handleFollow}
                followLoading={followLoading}
                onShare={handleShare}
            >
                {/* Application Status Banner for visitors */}
                {!isOwner && !isMember && currentUserId && rolesWithFilled.length > 0 && (
                    <div className="mb-6">
                        <ApplicationStatusBanner
                            status={applicationStatus.status}
                            roleTitle={applicationStatus.roleTitle}
                            canReapply={applicationStatus.canReapply}
                            waitTime={applicationStatus.waitTime}
                            onApply={() => setIsApplyModalOpen(true)}
                            isOwner={isOwner}
                            isMember={isMember}
                        />
                    </div>
                )}
                
                {renderTabContent()}

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
                    onSaved={() => router.refresh()}
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
                        onSuccess={() => router.refresh()}
                    />
                )}
            </ProjectLayout>
        </ProjectIntelligenceProvider>
    );
}
