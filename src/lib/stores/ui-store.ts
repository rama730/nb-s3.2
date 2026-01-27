import { create } from 'zustand'

interface UIState {
    // Sidebar
    sidebarOpen: boolean
    sidebarCollapsed: boolean

    // Mobile
    mobileMenuOpen: boolean

    // Theme
    theme: 'light' | 'dark' | 'system'

    // Actions
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    setSidebarCollapsed: (collapsed: boolean) => void
    setMobileMenuOpen: (open: boolean) => void
    setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useUIStore = create<UIState>()((set) => ({
    sidebarOpen: true,
    sidebarCollapsed: false,
    mobileMenuOpen: false,
    theme: 'system',

    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
    setTheme: (theme) => set({ theme }),
}))
