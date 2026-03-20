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
    X,
    Plus,
} from 'lucide-react'

const navItems = [
    { href: '/hub', icon: LayoutDashboard, label: 'Hub' },
    { href: '/explorer', icon: Compass, label: 'Explorer' },
    { href: '/people', icon: Users, label: 'People' },
    { href: '/messages', icon: MessageSquare, label: 'Messages' },
    { href: '/projects', icon: Folder, label: 'Projects' },
    { href: '/settings', icon: Settings, label: 'Settings' },
]

export function MobileNav() {
    const pathname = usePathname()
    const { mobileMenuOpen, setMobileMenuOpen } = useUIStore()

    if (!mobileMenuOpen) return null

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
                onClick={() => setMobileMenuOpen(false)}
            />

            {/* Drawer */}
            <div className="fixed inset-y-0 left-0 z-50 w-72 bg-background border-r shadow-lg md:hidden animate-in slide-in-from-left duration-300">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between app-density-panel border-b">
                        <Link href="/hub" className="flex items-center space-x-2">
                            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
                                E
                            </div>
                            <span className="font-semibold">Edge</span>
                        </Link>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* Create button */}
                    <div className="app-density-panel">
                        <Button className="w-full gap-2" asChild>
                            <Link href="/projects/new" onClick={() => setMobileMenuOpen(false)}>
                                <Plus className="h-4 w-4" />
                                Create Project
                            </Link>
                        </Button>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                            const Icon = item.icon

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className={cn(
                                        'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors app-density-nav-item',
                                        isActive
                                            ? 'app-selected-surface'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                    )}
                                >
                                    <Icon className="h-5 w-5" />
                                    <span>{item.label}</span>
                                </Link>
                            )
                        })}
                    </nav>
                </div>
            </div>
        </>
    )
}
