'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUIStore } from '@/lib/stores/ui-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    LayoutDashboard,
    Compass,
    Users,
    MessageSquare,
    Folder,
    Settings,
    ChevronLeft,
    Plus,
} from 'lucide-react'

const navItems = [
    { href: '/hub', icon: LayoutDashboard, label: 'Hub' },
    { href: '/explorer', icon: Compass, label: 'Explorer' },
    { href: '/people', icon: Users, label: 'People' },
    { href: '/messages', icon: MessageSquare, label: 'Messages' },
    { href: '/projects', icon: Folder, label: 'Projects' },
]

const secondaryItems = [
    { href: '/settings', icon: Settings, label: 'Settings' },
]

export function Sidebar() {
    const pathname = usePathname()
    const { sidebarCollapsed, setSidebarCollapsed } = useUIStore()

    return (
        <aside
            className={cn(
                'hidden md:flex flex-col sticky border-r bg-background transition-all duration-300',
                sidebarCollapsed ? 'w-16' : 'w-64'
            )}
            style={{ top: 'var(--ui-topnav-height)', height: 'calc(100vh - var(--ui-topnav-height))' }}
        >
            {/* Create button */}
            <div className="app-density-panel">
                <Button
                    className={cn(
                        'w-full gap-2 transition-all',
                        sidebarCollapsed && 'px-0 justify-center'
                    )}
                    asChild
                >
                    <Link href="/projects/new">
                        <Plus className="h-4 w-4" />
                        {!sidebarCollapsed && <span>Create Project</span>}
                    </Link>
                </Button>
            </div>

            {/* Main Navigation */}
            <nav className="flex-1 px-3 py-2 space-y-1">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                    const Icon = item.icon

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch={true}
                            className={cn(
                                'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors app-density-nav-item',
                                isActive
                                    ? 'app-selected-surface'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                                sidebarCollapsed && 'justify-center px-0'
                            )}
                        >
                            <Icon className="h-5 w-5 flex-shrink-0" />
                            {!sidebarCollapsed && <span>{item.label}</span>}
                        </Link>
                    )
                })}
            </nav>

            {/* Secondary Navigation */}
            <div className="px-3 py-2 border-t">
                {secondaryItems.map((item) => {
                    const isActive = pathname === item.href
                    const Icon = item.icon

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch={true}
                            className={cn(
                                'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors app-density-nav-item',
                                isActive
                                    ? 'app-selected-surface'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                                sidebarCollapsed && 'justify-center px-0'
                            )}
                        >
                            <Icon className="h-5 w-5 flex-shrink-0" />
                            {!sidebarCollapsed && <span>{item.label}</span>}
                        </Link>
                    )
                })}
            </div>

            {/* Collapse toggle */}
            <div className="app-density-panel border-t">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className={cn(
                        'w-full gap-2 justify-start',
                        sidebarCollapsed && 'justify-center px-0'
                    )}
                >
                    <ChevronLeft
                        className={cn(
                            'h-4 w-4 transition-transform',
                            sidebarCollapsed && 'rotate-180'
                        )}
                    />
                    {!sidebarCollapsed && <span>Collapse</span>}
                </Button>
            </div>
        </aside>
    )
}
