'use client'

import { useMemo, useState } from 'react'
import { Briefcase, CheckCircle2, EyeOff, Github, Globe, Pencil, Save, X } from 'lucide-react'
import Link from 'next/link'
import { Card } from './Card'
import type { ProfileCollaborationContribution, ProfileCollaborationRoleStage } from '@/lib/profile/collaboration'

interface ProjectContributionsCardProps {
    contributions: ProfileCollaborationContribution[]
    isOwner: boolean
    onAdd?: () => void
    projects?: any[]
    profileId?: string
    onProjectIntent?: (href: string) => void
    onStageUpdated?: () => Promise<void> | void
}

type EditableStage = {
    contribution: ProfileCollaborationContribution
    stage: ProfileCollaborationRoleStage
}

function formatDate(value: string | null | undefined) {
    if (!value) return null
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return value
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatRange(startDate: string | null | undefined, endDate: string | null | undefined, active?: boolean) {
    const start = formatDate(startDate)
    const end = active ? 'Present' : formatDate(endDate)
    if (start && end) return `${start} - ${end}`
    if (start) return `${start} - ${active ? 'Present' : 'Now'}`
    return active ? 'Present' : null
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
        visibility: contribution.visibility || 'public',
        manualOverride: false,
        statusLabel: contribution.currentlyActive ? 'Current' : 'Past role',
    }
}

export function ProjectContributionsCard({
    contributions,
    isOwner,
    onAdd,
    projects = [],
    profileId,
    onProjectIntent,
    onStageUpdated,
}: ProjectContributionsCardProps) {
    const [editing, setEditing] = useState<EditableStage | null>(null)
    const [draft, setDraft] = useState({ roleTitle: '', summary: '', skills: '', visibility: 'public' as 'public' | 'private' })
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const visibleContributions = useMemo(
        () => (contributions || []).filter(Boolean),
        [contributions],
    )

    const openStageEditor = (contribution: ProfileCollaborationContribution, stage: ProfileCollaborationRoleStage) => {
        setEditing({ contribution, stage })
        setDraft({
            roleTitle: stage.roleTitle || contribution.title || '',
            summary: stage.summary || '',
            skills: asTags(stage.skills).join(', '),
            visibility: stage.visibility || 'public',
        })
        setError(null)
    }

    const saveStage = async () => {
        if (!profileId || !editing || isSaving) return
        setIsSaving(true)
        setError(null)
        try {
            const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/collaboration-stages/${encodeURIComponent(editing.stage.id)}`, {
                method: 'PATCH',
                headers: {
                    accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    roleTitle: draft.roleTitle,
                    summary: draft.summary || null,
                    skills: asTags(draft.skills),
                    visibility: draft.visibility,
                }),
            })
            const body = await response.json().catch(() => null)
            if (!response.ok || body?.success === false) {
                throw new Error(body?.message || body?.error || 'Failed to update contribution')
            }
            await onStageUpdated?.()
            setEditing(null)
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Failed to update contribution')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Card
            title="Project Contributions"
            icon={<Briefcase className="w-5 h-5" />}
            onAdd={onAdd}
            addLabel="Add project contribution"
        >
            <div className="px-5 py-2">
                {visibleContributions.length > 0 ? (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {visibleContributions.map((contribution) => {
                            const linkedProject = contribution.projectId ? projects?.find((project) => project.id === contribution.projectId) : null
                            const projectTitle = linkedProject?.title || contribution.projectTitle || 'Unnamed Project'
                            const projectUrl = linkedProject?.url || contribution.projectHref || (linkedProject?.id ? `/projects/${linkedProject.id}` : null)
                            const stages = (contribution.roleStages?.length ? contribution.roleStages : [fallbackStage(contribution)])
                                .filter((stage) => stage.visibility !== 'private' || isOwner)
                            const hasProgression = stages.length > 1
                            const range = formatRange(contribution.startDate, contribution.endDate, contribution.currentlyActive)
                            const tags = asTags(contribution.skills)
                            const statusLabel = contribution.statusLabel || (contribution.currentlyActive ? 'Current' : 'Former collaborator')

                            return (
                                <article key={contribution.id} className="py-5">
                                    <div className="flex gap-3">
                                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                                            <Briefcase className="h-5 w-5" />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0">
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
                                                        ) : (
                                                            projectTitle
                                                        )}
                                                    </h4>
                                                    {!hasProgression ? (
                                                        <p className="mt-0.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-400">
                                                            {stages[0]?.roleTitle || contribution.title}
                                                        </p>
                                                    ) : null}
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-500">
                                                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                                        {statusLabel}
                                                    </span>
                                                    {range ? <span>{range}</span> : null}
                                                </div>
                                            </div>

                                            {contribution.description && !hasProgression ? (
                                                <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                                                    {contribution.description}
                                                </p>
                                            ) : null}

                                            {hasProgression ? (
                                                <div className="mt-4 space-y-0">
                                                    {stages.map((stage, stageIndex) => {
                                                        const isLast = stageIndex === stages.length - 1
                                                        const stageRange = formatRange(stage.startDate, stage.endDate, stage.currentlyActive)
                                                        return (
                                                            <div key={stage.id} className="relative pl-7 pb-5 last:pb-0">
                                                                {!isLast ? (
                                                                    <div className="absolute left-[5px] top-4 bottom-[-4px] w-px bg-zinc-200 dark:bg-zinc-800" />
                                                                ) : null}
                                                                <div className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-zinc-300 ring-4 ring-white dark:bg-zinc-600 dark:ring-zinc-950" />
                                                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                                                    <div className="min-w-0">
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <p className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">
                                                                                {stage.roleTitle}
                                                                            </p>
                                                                            {stage.verified ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : null}
                                                                            {stage.visibility === 'private' ? <EyeOff className="h-3.5 w-3.5 text-zinc-400" /> : null}
                                                                        </div>
                                                                        {stage.summary ? (
                                                                            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                                                                                {stage.summary}
                                                                            </p>
                                                                        ) : null}
                                                                        {stage.skills.length > 0 ? (
                                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                                {stage.skills.slice(0, 6).map((skill) => (
                                                                                    <span key={skill} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                                                                                        {skill}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                    <div className="flex shrink-0 items-center gap-2">
                                                                        {stageRange ? (
                                                                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                                                                                {stageRange}
                                                                            </span>
                                                                        ) : null}
                                                                        {isOwner && profileId ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => openStageEditor(contribution, stage)}
                                                                                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                                                                                aria-label={`Edit ${stage.roleTitle}`}
                                                                            >
                                                                                <Pencil className="h-3.5 w-3.5" />
                                                                            </button>
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="mt-2 flex items-center gap-2">
                                                    {stages[0]?.verified ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : null}
                                                    {isOwner && profileId && stages[0] ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openStageEditor(contribution, stages[0]!)}
                                                            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                                                            aria-label={`Edit ${stages[0].roleTitle}`}
                                                        >
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </button>
                                                    ) : null}
                                                </div>
                                            )}

                                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                                {tags.length > 0 ? (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {tags.map((tag) => (
                                                            <span key={tag} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : <span />}

                                                {contribution.repoUrl ? (
                                                    <a href={contribution.repoUrl} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="View repository">
                                                        {contribution.repoUrl.includes('github.com') ? <Github className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                                                    </a>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                ) : (
                    <div className="py-6 text-center">
                        {isOwner && onAdd ? (
                            <button
                                type="button"
                                onClick={onAdd}
                                className="text-sm font-medium text-indigo-600 hover:text-indigo-500 hover:underline dark:text-indigo-400"
                            >
                                Add your project contributions
                            </button>
                        ) : (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">No project contributions listed</p>
                        )}
                    </div>
                )}
            </div>

            {editing ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
                    <div role="dialog" aria-modal="true" aria-labelledby="profile-stage-edit-title" className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 id="profile-stage-edit-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                    Edit role stage
                                </h3>
                                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{editing.contribution.projectTitle}</p>
                            </div>
                            <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Close">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="mt-5 space-y-4">
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-stage-title">Role title</label>
                            <input
                                id="profile-stage-title"
                                value={draft.roleTitle}
                                onChange={(event) => setDraft((current) => ({ ...current, roleTitle: event.target.value.slice(0, 100) }))}
                                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
                            />

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-stage-start">Start</label>
                                    <input id="profile-stage-start" value={formatDate(editing.stage.startDate) || ''} readOnly className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-stage-end">End</label>
                                    <input id="profile-stage-end" value={editing.stage.currentlyActive ? 'Present' : (formatDate(editing.stage.endDate) || '')} readOnly className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" />
                                </div>
                            </div>

                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-stage-summary">Summary</label>
                            <textarea
                                id="profile-stage-summary"
                                value={draft.summary}
                                onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value.slice(0, 700) }))}
                                className="min-h-24 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
                            />

                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-stage-skills">Skills</label>
                            <input
                                id="profile-stage-skills"
                                value={draft.skills}
                                onChange={(event) => setDraft((current) => ({ ...current, skills: event.target.value }))}
                                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
                            />

                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="profile-stage-visibility">Visibility</label>
                            <select
                                id="profile-stage-visibility"
                                value={draft.visibility}
                                onChange={(event) => setDraft((current) => ({ ...current, visibility: event.target.value === 'private' ? 'private' : 'public' }))}
                                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950"
                            >
                                <option value="public">Public</option>
                                <option value="private">Private</option>
                            </select>

                            {error ? <p className="text-sm text-red-500">{error}</p> : null}

                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900">
                                    Cancel
                                </button>
                                <button type="button" onClick={saveStage} disabled={isSaving || !draft.roleTitle.trim()} className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                                    <Save className="h-4 w-4" />
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </Card>
    )
}
