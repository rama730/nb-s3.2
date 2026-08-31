import { create } from 'zustand'

export type WorkspaceTaskHandoff = { projectId: string; taskId: string; createdAt: number }
export type WorkspaceTab = "tasks" | "requests"
export const WORKSPACE_TASK_HANDOFF_STORAGE_KEY = 'nb:workspace-task-handoff'
const WORKSPACE_TASK_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000

export function createWorkspaceTaskHandoff(projectId: string, taskId: string): WorkspaceTaskHandoff {
    return { projectId, taskId, createdAt: Date.now() }
}

export function readWorkspaceTaskHandoff(value: string | null): WorkspaceTaskHandoff | null {
    if (!value) return null
    try {
        const handoff = JSON.parse(value) as Partial<WorkspaceTaskHandoff>
        return typeof handoff.projectId === 'string'
            && typeof handoff.taskId === 'string'
            && typeof handoff.createdAt === 'number'
            && Date.now() - handoff.createdAt >= 0
            && Date.now() - handoff.createdAt < WORKSPACE_TASK_HANDOFF_MAX_AGE_MS
            ? handoff as WorkspaceTaskHandoff
            : null
    } catch {
        return null
    }
}

interface UIState {
    // Sidebar
    sidebarOpen: boolean
    sidebarCollapsed: boolean

    // Mobile
    mobileMenuOpen: boolean

    // Theme
    theme: 'light' | 'dark' | 'system'

    // Workspace Drawer
    isWorkspaceOpen: boolean
    workspaceTab: WorkspaceTab
    workspaceTaskHandoff: WorkspaceTaskHandoff | null

    // Actions
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    setSidebarCollapsed: (collapsed: boolean) => void
    setMobileMenuOpen: (open: boolean) => void
    setTheme: (theme: 'light' | 'dark' | 'system') => void
    setWorkspaceOpen: (open: boolean) => void
    openWorkspace: (tab?: WorkspaceTab) => void
    setWorkspaceTab: (tab: WorkspaceTab) => void
    setWorkspaceTaskHandoff: (handoff: WorkspaceTaskHandoff | null) => void
}

export const useUIStore = create<UIState>()((set) => ({
    sidebarOpen: true,
    sidebarCollapsed: false,
    mobileMenuOpen: false,
    theme: 'system',

    // Workspace Drawer defaults
    isWorkspaceOpen: false,
    workspaceTab: "tasks",
    workspaceTaskHandoff: null,

    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
    setTheme: (theme) => set({ theme }),
    setWorkspaceOpen: (open) => set({ isWorkspaceOpen: open }),
    // ponytail: the launcher always has one predictable destination; callers
    // that need Requests ask for it explicitly instead of restoring stale UI.
    openWorkspace: (tab = "tasks") => set({ isWorkspaceOpen: true, workspaceTab: tab }),
    setWorkspaceTab: (tab) => set({ workspaceTab: tab }),
    setWorkspaceTaskHandoff: (handoff) => set({ workspaceTaskHandoff: handoff }),
}))
