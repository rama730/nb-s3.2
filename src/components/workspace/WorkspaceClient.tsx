'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
    getWorkspaceOverviewBase,
    getWorkspaceOverviewProjectsSection,
    type WorkspaceOverviewBaseData,
    type WorkspaceProject,
    type WorkspaceTask,
} from '@/app/actions/workspace';
import WorkspaceTabBar, { type WorkspaceTab } from './WorkspaceTabBar';
import OverviewTab from './tabs/OverviewTab';
import TasksTab from './tabs/TasksTab';
import InboxTab from './tabs/InboxTab';
import ProjectsTab from './tabs/ProjectsTab';
import NotesTab from './tabs/NotesTab';
import ActivityTab from './tabs/ActivityTab';
import TaskDetailPanel from '@/components/projects/v2/tasks/TaskDetailPanel';
import { WorkspaceSectionBoundary } from './WorkspaceSectionBoundary';
import { useWorkspaceRealtime } from '@/hooks/useWorkspaceRealtime';
import { useWorkspaceKeyboard } from '@/hooks/useWorkspaceKeyboard';
import { useTaskPanelData } from '@/hooks/useTaskPanelData';
import { queryKeys } from '@/lib/query-keys';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';

interface WorkspaceClientProps {
    initialData: WorkspaceOverviewBaseData | null;
    initialTab?: string;
}

const VALID_TABS: WorkspaceTab[] = ['overview', 'tasks', 'inbox', 'projects', 'notes', 'activity'];
const TAB_STORAGE_KEY = 'workspace-active-tab';

const TAB_TRANSITION = { duration: 0.15 };
const TAB_INITIAL = { opacity: 0, y: 4 };
const TAB_ANIMATE = { opacity: 1, y: 0 };
const TAB_EXIT = { opacity: 0, y: -4 };

export default function WorkspaceClient({ initialData, initialTab }: WorkspaceClientProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const reduceMotion = useReducedMotionPreference();

    const { data: baseData } = useQuery({
        queryKey: queryKeys.workspace.overviewBase(),
        queryFn: async () => {
            const result = await getWorkspaceOverviewBase();
            return result.success && result.data ? result.data : null;
        },
        initialData: initialData ?? undefined,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    });

    const { data: projectsData } = useQuery({
        queryKey: queryKeys.workspace.overviewSection.projects(),
        queryFn: async () => {
            const result = await getWorkspaceOverviewProjectsSection();
            return result.success && result.projects ? result.projects : [];
        },
        staleTime: 30_000,
    });

    // Remember last tab — URL param > localStorage > 'overview'
    const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
        if (VALID_TABS.includes(initialTab as WorkspaceTab)) return initialTab as WorkspaceTab;
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(TAB_STORAGE_KEY);
            if (saved && VALID_TABS.includes(saved as WorkspaceTab)) return saved as WorkspaceTab;
        }
        return 'overview';
    });

    const handleTabChange = useCallback((tab: WorkspaceTab) => {
        setActiveTab(tab);
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
    }, []);

    // Inline task detail panel
    const [selectedTask, setSelectedTask] = useState<WorkspaceTask | null>(null);

    const normalizedBaseData = useMemo<WorkspaceOverviewBaseData | null>(() => baseData ?? null, [baseData]);

    const projects: WorkspaceProject[] = useMemo(
        () => projectsData ?? [],
        [projectsData],
    );

    const overviewInitialSections = useMemo(() => ({ projects }), [projects]);

    const projectIds = useMemo(
        () => new Set([
            ...projects.map((p) => p.id),
            ...(normalizedBaseData?.projectRefs ?? []).map((p) => p.id),
        ]),
        [projects, normalizedBaseData?.projectRefs]
    );

    const handleTaskClick = useCallback((task: WorkspaceTask) => {
        setSelectedTask(task);
    }, []);

    const handleCloseTaskPanel = useCallback(() => {
        setSelectedTask(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewBase() });
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewSection.tasks() });
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace.tasksRoot() });
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace.activity() });
    }, [queryClient]);

    // Phase 1D: Lazy fetch sprints/members for task panel
    const { members, sprints } = useTaskPanelData(selectedTask?.projectId ?? null);

    // Contextual greeting
    const greeting = useMemo(() => getGreeting(normalizedBaseData ?? null), [normalizedBaseData]);

    // Tab badge counts
    const badges = useMemo(() => {
        if (!normalizedBaseData) return {};
        const overdueCount = normalizedBaseData.overdueCount;
        return {
            tasks: overdueCount || undefined,
            inbox: normalizedBaseData.inboxCount || undefined,
        };
    }, [normalizedBaseData]);

    // Realtime subscriptions
    useWorkspaceRealtime(user?.id ?? null);

    // Keyboard navigation
    useWorkspaceKeyboard(handleTabChange, handleCloseTaskPanel);

    // Ref to hold the enterEditMode function from OverviewTab
    const enterEditModeRef = useRef<(() => void) | null>(null);

    const handleCustomize = useCallback(() => {
        enterEditModeRef.current?.();
    }, []);

    const handleEditModeRegister = useCallback((enterFn: () => void) => {
        enterEditModeRef.current = enterFn;
    }, []);

    return (
        <div
            data-scroll-root="route"
            data-testid="workspace-route-scroll"
            className="h-full min-h-0 flex flex-col app-scroll app-scroll-y app-scroll-gutter"
        >
            {/* Header */}
            <div className="shrink-0 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between py-4">
                        <div>
                            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                                My Workspace
                            </h1>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {greeting}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <WorkspaceTabBar activeTab={activeTab} onTabChange={handleTabChange} badges={badges} />
                        {/* Customize button — only visible on the Overview tab */}
                        {activeTab === 'overview' && (
                            <button
                                onClick={handleCustomize}
                                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 transition-colors shrink-0 ml-2"
                                title="Customize dashboard layout"
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                                Customize
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Tab Content with animation */}
            <AnimatePresence mode="wait" initial={!reduceMotion}>
                {activeTab === 'overview' ? (
                    <motion.div
                        key="overview"
                        className="flex-1 min-h-0"
                        role="tabpanel"
                        id={`workspace-tab-${activeTab}`}
                        initial={reduceMotion ? { opacity: 0 } : TAB_INITIAL}
                        animate={reduceMotion ? { opacity: 1 } : TAB_ANIMATE}
                        exit={reduceMotion ? { opacity: 0 } : TAB_EXIT}
                        transition={reduceMotion ? { duration: 0 } : TAB_TRANSITION}
                    >
                        <WorkspaceSectionBoundary sectionName="Overview">
                            <OverviewTab
                                initialData={normalizedBaseData ?? null}
                                initialSections={overviewInitialSections}
                                onTaskClick={handleTaskClick}
                                onRequestEditMode={handleEditModeRegister}
                            />
                        </WorkspaceSectionBoundary>
                    </motion.div>
                ) : (
                    <motion.div
                        key={activeTab}
                        className="flex-1 min-h-0"
                        role="tabpanel"
                        id={`workspace-tab-${activeTab}`}
                        initial={reduceMotion ? { opacity: 0 } : TAB_INITIAL}
                        animate={reduceMotion ? { opacity: 1 } : TAB_ANIMATE}
                        exit={reduceMotion ? { opacity: 0 } : TAB_EXIT}
                        transition={reduceMotion ? { duration: 0 } : TAB_TRANSITION}
                    >
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                            {activeTab === 'tasks' && (
                                <WorkspaceSectionBoundary sectionName="Tasks">
                                    <TasksTab initialProjects={projects} onTaskClick={handleTaskClick} />
                                </WorkspaceSectionBoundary>
                            )}
                            {activeTab === 'inbox' && (
                                <WorkspaceSectionBoundary sectionName="Inbox">
                                    <InboxTab />
                                </WorkspaceSectionBoundary>
                            )}
                            {activeTab === 'projects' && (
                                <WorkspaceSectionBoundary sectionName="Projects">
                                    <ProjectsTab initialProjects={projects} />
                                </WorkspaceSectionBoundary>
                            )}
                            {activeTab === 'notes' && (
                                <WorkspaceSectionBoundary sectionName="Notes">
                                    <NotesTab projects={projects} />
                                </WorkspaceSectionBoundary>
                            )}
                            {activeTab === 'activity' && (
                                <WorkspaceSectionBoundary sectionName="Activity">
                                    <ActivityTab />
                                </WorkspaceSectionBoundary>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Inline Task Detail Panel */}
            <AnimatePresence initial={!reduceMotion}>
                {selectedTask && (
                    <TaskDetailPanel
                        task={{ ...selectedTask, project: { key: selectedTask.projectKey } }}
                        onClose={handleCloseTaskPanel}
                        isOwnerOrMember={projectIds.has(selectedTask.projectId)}
                        isOwner={false}
                        sprints={sprints}
                        members={members}
                        projectId={selectedTask.projectId}
                        currentUserId={user?.id}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function getGreeting(data: WorkspaceOverviewBaseData | null): string {
    const hour = new Date().getHours();
    const prefix = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    if (!data) return `${prefix} — loading your workspace.`;

    const overdueCount = data.overdueCount;
    const inProgressCount = data.inProgressCount;
    const dueToday = data.tasksDueCount;

    if (overdueCount > 0) return `${prefix} — you have ${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}.`;
    if (dueToday > 0) return `${prefix} — ${dueToday} task${dueToday > 1 ? 's' : ''} due today.`;
    if (inProgressCount > 0) return `${prefix} — ${inProgressCount} task${inProgressCount > 1 ? 's' : ''} in progress.`;
    return `${prefix} — you're all clear.`;
}
