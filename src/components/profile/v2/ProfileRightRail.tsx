'use client'

import React, { useId } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Briefcase, Users, FolderKanban, Link2, Sparkles, MessageSquare, Pencil, Github, Linkedin, Globe } from 'lucide-react'
import type { ProfileStats } from './types'
import { normalizeProfileVM } from './utils/normalizeProfileVM'
import { availabilityStatusLabel, countLabel } from '@/lib/profile/display'
import { normalizeSocialLinks as normalizeSocialLinksShared } from '@/lib/profile/normalization'

function RailCard({
    title,
    icon,
    children,
    className,
    id,
}: {
    title: string
    icon?: React.ReactNode
    children: React.ReactNode
    className?: string
    id?: string
}) {
    const headingId = useId()
    return (
        <section
            aria-labelledby={headingId}
            id={id}
            className={cn('rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm', className)}
        >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                {icon ? <span className="text-zinc-500 dark:text-zinc-400">{icon}</span> : null}
                <h2 id={headingId} className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{title}</h2>
            </div>
            <div className="px-5 py-4">{children}</div>
        </section>
    )
}

function Stat({
    label,
    value,
    href,
    onClick,
}: {
    label: string
    value: number
    href?: string
    onClick?: () => void
}) {
    const ariaLabel = countLabel(value, label.replace(/s$/, ''), label)
    const inner = (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-4 py-3">
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{value}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        </div>
    )
    return href ? (
        <Link href={href} aria-label={ariaLabel} className="block hover:opacity-90">
            {inner}
        </Link>
    ) : onClick ? (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className="block w-full text-left hover:opacity-90 transition-opacity"
        >
            {inner}
        </button>
    ) : (
        <div role="group" aria-label={ariaLabel}>
            {inner}
        </div>
    )
}

// C6: normalizeSocialLinks is now imported from @/lib/profile/normalization
const normalizeSocialLinks = normalizeSocialLinksShared;

export const ProfileRightRail = React.memo(function ProfileRightRail({
    profile,
    stats,
    isOwner,
    socialLinks,
    onInvite,
    onConnectionsClick,
    onEditSection,
    publicProfileHref,
}: {
    profile: any
    stats: ProfileStats
    isOwner: boolean
    socialLinks: any
    onInvite: () => void
    onConnectionsClick: () => void
    onEditSection?: (section: "general" | "experience" | "education" | "skills" | "social") => void
    publicProfileHref?: string | null
}) {
    const vm = normalizeProfileVM(profile)
    const openTo = vm.openTo
    const availability = vm.availabilityStatus
    // H7: URL validation is built into normalizeSocialLinks (rejects non-http(s))
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
    const completionScore = Number(vm.profileStrength || 0)
    const missingItems: string[] = Array.isArray((profile as any)?.completionMissing)
        ? (profile as any).completionMissing
        : []

    return (
        <>
            <RailCard id="profile-collaboration" title="Collaboration" icon={<Sparkles className="w-4 h-4" />}>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300">Availability</div>
                        <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", availabilityTone)}>
                            {availabilityStatusLabel(availability)}
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
                    <Stat label="Connections" value={stats.connectionsCount || 0} onClick={onConnectionsClick} />
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
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        {isOwner && onEditSection ? (
                            <button
                                type="button"
                                onClick={() => onEditSection('social')}
                                className="font-medium text-indigo-600 hover:text-indigo-500"
                            >
                                Add your first link
                            </button>
                        ) : (
                            'No links added yet.'
                        )}
                    </div>
                )}
            </RailCard>

            {isOwner ? (
                <RailCard title="Profile Completeness" icon={<Sparkles className="w-4 h-4" />}>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-600 dark:text-zinc-300">Completion</span>
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {completionScore}%
                            </span>
                        </div>
                        <div
                            role="progressbar"
                            aria-valuenow={Math.max(0, Math.min(100, completionScore))}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Profile completeness: ${completionScore}%`}
                            className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
                        >
                            <div
                                className="h-full bg-indigo-600 dark:bg-indigo-400 transition-all"
                                style={{ width: `${Math.max(0, Math.min(100, completionScore))}%` }}
                            />
                        </div>
                        {missingItems.length > 0 ? (
                            <ul className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {missingItems.slice(0, 3).map((item) => (
                                    <li key={item}>• {item}</li>
                                ))}
                            </ul>
                        ) : completionScore >= 100 ? (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                Profile is complete. Great work.
                            </p>
                        ) : null}
                    </div>
                </RailCard>
            ) : null}

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
                            {publicProfileHref ? (
                                <Link
                                    href={publicProfileHref}
                                    className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                >
                                    Public profile
                                </Link>
                            ) : null}
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
})
