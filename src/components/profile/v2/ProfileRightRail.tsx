'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Briefcase, Users, FolderKanban, Link2, Sparkles, MessageSquare, Pencil, Github, Linkedin, Globe } from 'lucide-react'
import type { ProfileStats } from './types'
import { normalizeProfileVM } from './utils/normalizeProfileVM'

function RailCard({
    title,
    icon,
    children,
    className,
}: {
    title: string
    icon?: React.ReactNode
    children: React.ReactNode
    className?: string
}) {
    return (
        <section className={cn('rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm', className)}>
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                {icon ? <span className="text-zinc-500 dark:text-zinc-400">{icon}</span> : null}
                <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{title}</h3>
            </div>
            <div className="px-5 py-4">{children}</div>
        </section>
    )
}

function Stat({
    label,
    value,
    href,
}: {
    label: string
    value: number
    href?: string
}) {
    const inner = (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-4 py-3">
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{value}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        </div>
    )
    return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner
}

function normalizeSocialLinks(profile: any, list: any): Array<{ label: string; url: string }> {
    const out: Array<{ label: string; url: string }> = []

    const add = (label: string, url: string) => {
        const u = String(url || '').trim()
        if (!u) return
        const l = String(label || 'Link').trim()
        // Deduplicate
        if (!out.some(x => x.url === u)) {
            // Startup case for label
            const formattedLabel = l.charAt(0).toUpperCase() + l.slice(1)
            out.push({ label: formattedLabel, url: u })
        }
    }

    // 1. Check profile.socialLinks (or social_links) if it's an object
    const json = profile?.socialLinks || profile?.social_links
    if (json && typeof json === 'object' && !Array.isArray(json)) {
        for (const [k, v] of Object.entries(json)) {
            add(k, v as string)
        }
    }

    // 2. Check the 'list' argument.
    if (Array.isArray(list)) {
        // Legacy table concept
        for (const row of list) {
            add(row?.platform || row?.label, row?.url)
        }
    } else if (list && typeof list === 'object') {
        // If list is passed as the object itself
        for (const [k, v] of Object.entries(list)) {
            add(k, v as string)
        }
    }

    return out
}

export function ProfileRightRail({
    profile,
    stats,
    isOwner,
    socialLinks,
    onInvite,
    onConnectionsClick,
}: {
    profile: any
    stats: ProfileStats
    isOwner: boolean
    socialLinks: any
    onInvite: () => void
    onConnectionsClick: () => void
}) {
    const vm = normalizeProfileVM(profile)
    const openTo = vm.openTo
    const availability = vm.availabilityStatus
    const links = normalizeSocialLinks({ ...profile, socialLinks: vm.socialLinks }, socialLinks)

    const availabilityTone =
        availability === 'available' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40'
        : availability === 'busy' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-900/40'
        : availability === 'focusing' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/40'
        : 'bg-zinc-50 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'

    const linkIconFor = (url: string) => {
        const u = (url || '').toLowerCase()
        if (u.includes('github.com')) return <Github className="w-4 h-4" />
        if (u.includes('linkedin.com')) return <Linkedin className="w-4 h-4" />
        return <Globe className="w-4 h-4" />
    }

    return (
        <>
            <RailCard title="Collaboration" icon={<Sparkles className="w-4 h-4" />}>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300">Availability</div>
                        <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", availabilityTone)}>
                            {String(availability).replace(/_/g, ' ')}
                        </span>
                    </div>

                    {openTo.length ? (
                        <div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Open to</div>
                            <div className="flex flex-wrap gap-2">
                                {openTo.slice(0, 10).map((x) => (
                                    <span
                                        key={x}
                                        className="text-xs px-2.5 py-1 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700"
                                    >
                                        {x}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-zinc-500 dark:text-zinc-400">No collaboration preferences yet.</div>
                    )}

                    {!isOwner ? (
                        <button
                            type="button"
                            onClick={onInvite}
                            className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                            <Briefcase className="w-4 h-4" />
                            Invite to project
                        </button>
                    ) : null}
                </div>
            </RailCard>

            <RailCard title="Stats" icon={<Users className="w-4 h-4" />}>
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onConnectionsClick} className="text-left w-full hover:opacity-90 transition-opacity">
                        <Stat label="Connections" value={stats.connectionsCount || 0} />
                    </button>
                    <Stat label="Projects" value={stats.projectsCount || 0} href="/projects" />
                </div>
                <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    Followers are coming soon. Your profile focuses on real collaboration, not vanity metrics.
                </div>
            </RailCard>

            <RailCard title="Links" icon={<Link2 className="w-4 h-4" />}>
                {links.length ? (
                    <div className="space-y-2">
                        {links.slice(0, 8).map((l) => (
                            <a
                                key={l.url}
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                            >
                                <span className="text-sm text-zinc-700 dark:text-zinc-200 flex items-center gap-2 min-w-0">
                                    <span className="text-zinc-400">{linkIconFor(l.url)}</span>
                                    <span className="truncate">{l.label}</span>
                                </span>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[140px]">{l.url}</span>
                            </a>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">No links added yet.</div>
                )}
            </RailCard>

            <RailCard title="Shortcuts" icon={<FolderKanban className="w-4 h-4" />}>
                <div className="grid grid-cols-2 gap-2">
                    {isOwner ? (
                        <>
                            <Link
                                href="/profile"
                                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                            >
                                <Pencil className="w-4 h-4 text-zinc-400" />
                                Edit profile
                            </Link>
                            <Link
                                href="/projects"
                                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                            >
                                My projects
                            </Link>
                        </>
                    ) : (
                        <>
                            <Link
                                href={vm?.id ? `/messages?userId=${vm.id}` : '/messages'}
                                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                            >
                                <MessageSquare className="w-4 h-4 text-zinc-400" />
                                Message
                            </Link>
                            <Link
                                href="/projects"
                                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                            >
                                Browse projects
                            </Link>
                        </>
                    )}
                </div>
            </RailCard>
        </>
    )
}
