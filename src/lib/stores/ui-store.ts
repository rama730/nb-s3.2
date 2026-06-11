import { create } from 'zustand'

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
    workspaceTab: "overview" | "tasks" | "sprints" | "members" | "notes"
    workspaceTaskId: string | null

    // Actions
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    setSidebarCollapsed: (collapsed: boolean) => void
    setMobileMenuOpen: (open: boolean) => void
    setTheme: (theme: 'light' | 'dark' | 'system') => void
    setWorkspaceOpen: (open: boolean) => void
    toggleWorkspace: () => void
    setWorkspaceTab: (tab: "overview" | "tasks" | "sprints" | "members" | "notes") => void
    setWorkspaceTaskId: (id: string | null) => void
}

export const useUIStore = create<UIState>()((set) => ({
    sidebarOpen: true,
    sidebarCollapsed: false,
    mobileMenuOpen: false,
    theme: 'system',

    // Workspace Drawer defaults
    isWorkspaceOpen: false,
    workspaceTab: "overview",
    workspaceTaskId: null,

    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
    setTheme: (theme) => set({ theme }),
    setWorkspaceOpen: (open) => set({ isWorkspaceOpen: open }),
    toggleWorkspace: () => set((state) => ({ isWorkspaceOpen: !state.isWorkspaceOpen })),
    setWorkspaceTab: (tab) => set({ workspaceTab: tab }),
    setWorkspaceTaskId: (id) => set({ workspaceTaskId: id }),
}))
