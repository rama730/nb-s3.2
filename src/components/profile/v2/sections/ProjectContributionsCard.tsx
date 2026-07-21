'use client'

import { useMemo } from 'react'
import { Briefcase, EyeOff, Github, Globe, Pencil } from 'lucide-react'
import Link from 'next/link'
import { Card } from './Card'
import type { ProfileCollaborationContribution, ProfileCollaborationRoleStage } from '@/lib/profile/collaboration'
import { SkillList } from '@/components/skills/SkillList'

interface ProjectContributionsCardProps {
    contributions: ProfileCollaborationContribution[]
    isOwner: boolean
    onAdd?: () => void
    projects?: Array<{ id?: string; title?: string; url?: string }>
    onProjectIntent?: (href: string) => void
}

function formatJoinedDate(value: string | null | undefined) {
    if (!value) return null
    const month = /^(\d{4})-(\d{2})/.exec(value)
    const date = month
        ? new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1))
        : new Date(value)
    if (!Number.isFinite(date.getTime())) return value
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function asTags(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean)
    if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean)
    return []
}

function fallbackStage(contribution: ProfileCollaborationContribution): ProfileCollaborationRoleStage {
    return {
        id: `${contribution.id}:stage`,
        contributionId: contribution.id,
        roleKind: contribution.roleKind || 'contributor',
        roleTitle: contribution.title || 'Contributor',
        summary: contribution.description,
        skills: contribution.skills || [],
        startDate: contribution.startDate,
        endDate: contribution.endDate,
        startedAt: contribution.startDate,
        endedAt: contribution.endDate,
        currentlyActive: Boolean(contribution.currentlyActive),
        source: contribution.source || 'manual',
        verified: Boolean(contribution.verified),
        verifiedAt: null,
    }
}

export function ProjectContributionsCard({
    contributions,
    isOwner,
    onAdd,
    projects = [],
    onProjectIntent,
}: ProjectContributionsCardProps) {
    const visibleContributions = useMemo(
        () => (contributions || []).filter((contribution) => contribution && (isOwner || contribution.visibility === 'public')),
        [contributions, isOwner],
    )

    return (
        <Card
            title="Project Contributions"
            icon={<Briefcase className="h-5 w-5" />}
            onAdd={onAdd}
            addLabel="Add project contribution"
            action={isOwner && onAdd ? (
                <button
                    type="button"
                    onClick={onAdd}
                    aria-label="Edit project contributions"
                    className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                    <Pencil className="h-4 w-4" />
                </button>
            ) : null}
        >
            <div className="px-5 py-2">
                {visibleContributions.length > 0 ? (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {visibleContributions.map((contribution) => {
                            const linkedProject = contribution.projectId
                                ? projects.find((project) => project.id === contribution.projectId)
                                : null
                            const projectTitle = linkedProject?.title || contribution.projectTitle || 'Unnamed project'
                            const projectUrl = linkedProject?.url || contribution.projectHref || contribution.projectUrl || null
                            // The parent row is the only visibility authority. Stages never override it.
                            const stages = contribution.roleStages?.length
                                ? contribution.roleStages
                                : [fallbackStage(contribution)]
                            const hasProgression = stages.length > 1
                            const joinedDate = formatJoinedDate(contribution.startDate)
                            const tags = asTags(contribution.skills)
                            const isPrivate = contribution.visibility === 'private'

                            return (
                                <article key={contribution.id} className="py-5">
                                    <div className="min-w-0">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h4 className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {projectUrl ? (
                                                            <Link
                                                                href={projectUrl}
                                                                target={projectUrl.startsWith('/') ? '_self' : '_blank'}
                                                                rel="noreferrer"
                                                                onMouseEnter={() => onProjectIntent?.(projectUrl)}
                                                                onFocus={() => onProjectIntent?.(projectUrl)}
                                                                className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
                                                            >
                                                                {projectTitle}
                                                            </Link>
                                                        ) : projectTitle}
                                                        {contribution.title ? ` | ${contribution.title}` : ''}
                                                    </h4>
                                                    {isOwner && isPrivate ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500" title="Only you can see this contribution">
                                                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Private
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            {joinedDate ? (
                                                <span className="shrink-0 text-xs font-medium text-zinc-500">{joinedDate}</span>
                                            ) : null}
                                        </div>

                                        {contribution.description && !hasProgression ? (
                                            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                                                {contribution.description}
                                            </p>
                                        ) : null}

                                        {hasProgression ? (
                                            <div className="mt-4">
                                                {stages.map((stage, stageIndex) => {
                                                    const isLast = stageIndex === stages.length - 1
                                                    const stageDate = formatJoinedDate(stage.startDate)
                                                    return (
                                                        <div key={stage.id} className="relative pb-5 pl-7 last:pb-0">
                                                            {!isLast ? <div className="absolute bottom-[-4px] left-[5px] top-4 w-px bg-zinc-200 dark:bg-zinc-800" /> : null}
                                                            <div className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-zinc-300 ring-4 ring-white dark:bg-zinc-600 dark:ring-zinc-950" />
                                                            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                                                <div className="min-w-0">
                                                                    <p className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{stage.roleTitle}</p>
                                                                    {stage.summary ? <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{stage.summary}</p> : null}
                                                                    {stage.skills.length > 0 ? <SkillList skills={stage.skills} maxVisible={6} size="sm" className="mt-2" /> : null}
                                                                </div>
                                                                {stageDate ? <span className="shrink-0 text-xs font-medium text-zinc-500">{stageDate}</span> : null}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        ) : null}

                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                            {tags.length > 0 ? <SkillList skills={tags} maxVisible={8} size="sm" /> : <span />}
                                            {contribution.repoUrl ? (
                                                <a href={contribution.repoUrl} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="View repository">
                                                    {contribution.repoUrl.includes('github.com') ? <Github className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                                                </a>
                                            ) : null}
                                        </div>
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                ) : (
                    <div className="py-6 text-center">
                        {isOwner && onAdd ? (
                            <button type="button" onClick={onAdd} className="text-sm font-medium text-indigo-600 hover:text-indigo-500 hover:underline dark:text-indigo-400">
                                Add your first project contribution
                            </button>
                        ) : (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">No public project contributions</p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    )
}
