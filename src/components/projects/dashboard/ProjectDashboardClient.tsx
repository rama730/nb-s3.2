"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import ProjectLayout from "@/components/projects/dashboard/ProjectLayout";
import { TabErrorBoundary } from "@/components/projects/TabErrorBoundary";
import type { Project } from "@/types/hub";
import { toggleProjectBookmarkAction, toggleProjectFollowAction, startSprintAction, completeSprintAction, moveTaskToSprintAction } from "@/app/actions/project";

// Skeleton for lazy-loaded tabs
function TabSkeleton() {
    return (
        <div className="animate-pulse space-y-4">
            <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded-lg w-1/3" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-48 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
                <div className="h-48 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
            </div>
            <div className="h-64 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
        </div>
    );
}

// Lazy load tab components - only Dashboard loads immediately, others on-demand
const DashboardTab = dynamic(
    () => import("@/components/projects/tabs/DashboardTab"),
    { loading: () => <TabSkeleton />, ssr: true }
);

const TasksTab = dynamic(
    () => import("@/components/projects/v2/TasksTab"),
    { loading: () => <TabSkeleton />, ssr: false }
);

const FilesTab = dynamic(
    () => import("@/components/projects/v2/ProjectFilesWorkspace"),
    { loading: () => <TabSkeleton />, ssr: false }
);

const AnalyticsTab = dynamic(
    () => import("@/components/projects/tabs/AnalyticsTab"),
    { loading: () => <TabSkeleton />, ssr: false }
);

const SprintPlanning = dynamic(
    () => import("@/components/projects/tabs/SprintPlanning"),
    { loading: () => <TabSkeleton />, ssr: false }
);

const BurndownChart = dynamic(
    () => import("@/components/projects/tabs/BurndownChart"),
    { loading: () => <div className="h-[300px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-xl" />, ssr: false }
);

const ProjectSettingsTab = dynamic(
    () => import("@/components/projects/tabs/ProjectSettingsTab"),
    { loading: () => <TabSkeleton />, ssr: false }
);

const EditProjectModal = dynamic(
    () => import("@/components/projects/EditProjectModal"),
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
    const [isBookmarked, setIsBookmarked] = useState((project as any).is_saved || false);
    const [isFollowing, setIsFollowing] = useState((project as any).is_followed || false);
    const [bookmarkLoading, setBookmarkLoading] = useState(false);
    const [shareCopied, setShareCopied] = useState(false);
    const [followersCount, setFollowersCount] = useState((project as any).followers_count || 0);
    const [bookmarkCount, setBookmarkCount] = useState(0); // View count is handled separately, Bookmark count usually private
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // Derived state
    const isOwnerOrMember = isOwner || isMember;

    // Extended project data (may come from joined queries, cast to any for flexibility)
    const extendedProject = project as any;

    // Extract data from project - using extended fields that may come from backend joins
    const tasks = extendedProject?.project_tasks || [];
    const files = extendedProject?.project_files || [];
    const initialFileNodes = extendedProject?.initialFileNodes || [];
    const members = project?.project_collaborators || [];
    const sprints = extendedProject?.project_sprints || [];

    // Combine owner and members for assignment
    const allMembers = useMemo(() => {
        const collab = project?.project_collaborators || [];
        const owner = extendedProject?.owner || (project as any).owner;
        
        // If owner object exists, ensure it's in the list
        if (owner) {
            // Check if already in collaborators (unlikely but safe to check)
            const exists = collab.find((m: any) => m.id === owner.id);
            if (!exists) {
                return [owner, ...collab];
            }
        }
        return collab;
    }, [project, extendedProject]);

    const rolesWithFilled = useMemo(() => {
        const roles = project?.project_open_roles || [];
        return roles.map((role: any) => {
            const filledCount = members.filter((m: any) => m.role === role.role).length;
            return { ...role, filled: filledCount };
        });
    }, [project?.project_open_roles, members]);

    const lifecycleStages = useMemo(() => {
        // Handle both camelCase (Drizzle) and snake_case (Legacy/Raw)
        const stages = extendedProject?.lifecycleStages || extendedProject?.lifecycle_stages || [];
        const currentIndex = extendedProject?.currentStageIndex ?? extendedProject?.current_stage_index ?? 0;
        return stages.map((stageName: string, idx: number) => ({
            name: stageName,
            status: idx < currentIndex ? "completed" : idx === currentIndex ? "current" : "upcoming",
        }));
    }, [extendedProject]);

    // Tab change handler
    const handleTabChange = useCallback((tabId: string) => {
        setActiveTab(tabId);
        // Update URL without reload
        const params = new URLSearchParams(window.location.search);
        params.set("tab", tabId);
        router.replace(`?${params.toString()}`, { scroll: false });
    }, [router]);

    // Actions
    const handleEdit = useCallback((section?: string) => {
        setIsEditModalOpen(true);
        // Optional: Could pre-select tab based on section
    }, []);

    const handleShare = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setShareCopied(true);
            toast.success("Link copied to clipboard");
            setTimeout(() => setShareCopied(false), 2000);
        } catch {
            toast.error("Failed to copy link");
        }
    }, []);

    const handleBookmark = useCallback(async () => {
        if (!currentUserId) {
            toast.error("Please log in to save projects");
            return;
        }
        setBookmarkLoading(true);
        // Optimistic update
        const newIsBookmarked = !isBookmarked;
        setIsBookmarked(newIsBookmarked);
        setBookmarkCount((c) => newIsBookmarked ? c + 1 : c - 1);
        
        try {
            const result = await toggleProjectBookmarkAction(project.id, newIsBookmarked);
            if (!result.success) throw new Error(result.error);
            toast.success(newIsBookmarked ? "Saved to collection" : "Removed from saved");
        } catch (error) {
            // Revert on failure
            setIsBookmarked(!newIsBookmarked);
            setBookmarkCount((c) => !newIsBookmarked ? c + 1 : c - 1);
            toast.error("Failed to update bookmark");
        } finally {
            setBookmarkLoading(false);
        }
    }, [currentUserId, isBookmarked, project.id]);

    const handleFollow = useCallback(async () => {
        if (!currentUserId) {
            toast.error("Please log in to follow projects");
            return;
        }
        // Optimistic update
        const newIsFollowing = !isFollowing;
        setIsFollowing(newIsFollowing);
        setFollowersCount((c: number) => newIsFollowing ? c + 1 : c - 1);

        try {
            const result = await toggleProjectFollowAction(project.id, newIsFollowing);
            if (!result.success) throw new Error(result.error);
            toast.success(newIsFollowing ? "Following project" : "Unfollowed project");
        } catch (error) {
            // Revert
            setIsFollowing(!newIsFollowing);
            setFollowersCount((c: number) => !newIsFollowing ? c + 1 : c - 1);
            toast.error("Failed to update follow status");
        }
    }, [currentUserId, isFollowing, project.id]);

    const handleApplyToRole = useCallback((role: any) => {
        if (!currentUserId) {
            toast.error("Please log in to apply");
            return;
        }
        // TODO: Implement apply modal
        toast.info("Application feature coming soon");
    }, [currentUserId]);

    const handleAdvanceStage = useCallback(() => {
        // TODO: Implement stage advancement
        toast.info("Stage advancement coming soon");
    }, []);

    const handleFinalize = useCallback(() => {
        // TODO: Implement project finalization
        toast.info("Project finalization coming soon");
    }, []);

    // Memoize the Files tab to prevent unmounting/remounting on parent re-renders (e.g. scroll)
    const filesTabContent = useMemo(() => (
        <TabErrorBoundary tabName="Files">
            <FilesTab
                projectId={project.id}
                projectName={project.title}
                currentUserId={currentUserId || undefined}
                isOwnerOrMember={isOwnerOrMember}
                initialFileNodes={initialFileNodes}
            />
        </TabErrorBoundary>
    ), [project.id, project.title, currentUserId, isOwnerOrMember, initialFileNodes]);

    // Render active tab content
    const renderTabContent = () => {
        switch (activeTab) {
            case "dashboard":
                return (
                    <TabErrorBoundary tabName="Dashboard">
                        <DashboardTab
                            project={project}
                            isCreator={isOwner}
                            isOwnerOrMember={isOwnerOrMember}
                            isCollaborator={isMember}
                            currentUserId={currentUserId}
                            tasks={tasks}
                            dashboardTasks={tasks.slice(0, 10)}
                            files={files}
                            members={members}
                            rolesWithFilled={rolesWithFilled}
                            projectActivityEvents={[]}
                            followersCount={followersCount}
                            bookmarkCount={bookmarkCount}
                            bookmarked={isBookmarked}
                            bookmarkLoading={bookmarkLoading}
                            shareCopied={shareCopied}
                            onEdit={handleEdit}
                            onShare={handleShare}
                            onBookmark={handleBookmark}
                            onFinalize={handleFinalize}
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
                            projectCreatorId={project.owner_id}
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
                        <AnalyticsTab projectId={project.id} project={project} />
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
        <ProjectLayout
            project={project}
            isOwner={isOwner}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            followersCount={followersCount}
            onEdit={() => handleEdit()}
            isBookmarked={isBookmarked}
            onBookmark={handleBookmark}
            isFollowing={isFollowing}
            onFollow={handleFollow}
            onShare={handleShare}
        >
            {renderTabContent()}
            
            <EditProjectModal 
                project={extendedProject}
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSaved={() => router.refresh()}
            />
        </ProjectLayout>
    );
}
