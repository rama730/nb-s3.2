'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEFAULT_CLIENT_SKILLS, resolveClientSkill } from '@/lib/skills/client'
import { SKILL_CLIENT_CATALOG_VERSION, SKILL_CLIENT_CATEGORIES } from '@/lib/skills/generated-client-catalog'
import { normalizeSkillLookup } from '@/lib/skills/normalization'
import type { SkillSummary } from '@/lib/skills/types'
import { SkillChip } from './SkillChip'
import { SkillIcon } from './SkillIcon'

type SkillsEnvelope = { success: true; data: { skills: SkillSummary[] } }

export function SkillPicker({
    value,
    onChange,
    maxSkills = 25,
    allowCustom = true,
    label = 'Skills & expertise',
    description = 'Search the market catalog or add a custom skill.',
    compact = false,
    placeholder = 'Search React, Figma, leadership…',
    className,
}: {
    value: string[]
    onChange: (skills: string[]) => void
    maxSkills?: number
    allowCustom?: boolean
    label?: string
    description?: string
    compact?: boolean
    placeholder?: string
    className?: string
}) {
    const inputId = useId()
    const listboxId = useId()
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState<string>('all')
    const [results, setResults] = useState<SkillSummary[]>(DEFAULT_CLIENT_SKILLS)
    const [loading, setLoading] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const requestRef = useRef<AbortController | null>(null)
    const selectedKeys = useMemo(() => new Set(value.map((skill) => resolveClientSkill(skill).canonicalKey)), [value])

    useEffect(() => {
        const controller = new AbortController()
        requestRef.current?.abort()
        requestRef.current = controller
        const timer = window.setTimeout(async () => {
            setLoading(true)
            try {
                // Version the request URL as well as the response ETag. This prevents
                // a CDN/browser from serving a previous catalog release for up to the
                // stale-while-revalidate window after an icon release is deployed.
                const params = new URLSearchParams({ limit: '30', catalog: SKILL_CLIENT_CATALOG_VERSION })
                if (query.trim()) params.set('q', query.trim())
                else params.set('tier', 'core')
                if (category !== 'all') params.set('category', category)
                const response = await fetch(`/api/v1/skills?${params}`, { signal: controller.signal })
                if (!response.ok) throw new Error('Skill search failed')
                const payload = await response.json() as SkillsEnvelope
                if (!controller.signal.aborted) {
                    setResults(payload.data.skills)
                    setActiveIndex(0)
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    setResults(query.trim() ? [] : DEFAULT_CLIENT_SKILLS)
                    console.warn('[skills] catalog search unavailable', error)
                }
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }, query.trim() ? 180 : 0)
        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [category, query])

    const selectableResults = useMemo(
        () => results.filter((skill) => !selectedKeys.has(skill.canonicalKey)),
        [results, selectedKeys],
    )
    const exactMatch = results.some((skill) => normalizeSkillLookup(skill.name) === normalizeSkillLookup(query))
    const canAddCustom = allowCustom && query.trim().length >= 2 && !exactMatch && !selectedKeys.has(resolveClientSkill(query).canonicalKey)
    const optionCount = selectableResults.length + (canAddCustom ? 1 : 0)

    const selectSkill = useCallback((name: string) => {
        if (value.length >= maxSkills) return
        const canonical = resolveClientSkill(name)
        if (selectedKeys.has(canonical.canonicalKey)) return
        onChange([...value, canonical.name])
        setQuery('')
    }, [maxSkills, onChange, selectedKeys, value])

    const removeSkill = (name: string) => {
        const key = resolveClientSkill(name).canonicalKey
        onChange(value.filter((skill) => resolveClientSkill(skill).canonicalKey !== key))
    }

    return (
        <div className={cn('min-w-0 space-y-3', className)}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <label htmlFor={inputId} className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</label>
                    <p id={`${inputId}-description`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-zinc-500" aria-live="polite">{value.length}/{maxSkills}</span>
            </div>

            {value.length > 0 ? (
                <div className="flex min-w-0 flex-wrap gap-2" aria-label="Selected skills">
                    {value.map((skill) => <SkillChip key={resolveClientSkill(skill).canonicalKey} skill={skill} size={compact ? 'sm' : 'md'} onRemove={() => removeSkill(skill)} />)}
                </div>
            ) : null}

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                    id={inputId}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(Math.max(0, optionCount - 1), index + 1)) }
                        if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)) }
                        if (event.key === 'Escape') { setQuery(''); setActiveIndex(0) }
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            const result = selectableResults[activeIndex]
                            if (result) selectSkill(result.name)
                            else if (canAddCustom) selectSkill(query.trim())
                        }
                    }}
                    role="combobox"
                    aria-expanded="true"
                    aria-haspopup="listbox"
                    aria-controls={listboxId}
                    aria-describedby={`${inputId}-description`}
                    aria-activedescendant={optionCount > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
                    autoComplete="off"
                    placeholder={placeholder}
                    className="h-11 w-full rounded-lg border border-zinc-300 bg-white pl-10 pr-10 text-sm text-zinc-900 outline-none transition focus:border-blue-500   disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    disabled={value.length >= maxSkills}
                />
                {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-label="Searching skills" /> : null}
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Filter skills by category">
                <button type="button" onClick={() => setCategory('all')} className={cn('whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium', category === 'all' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300')}>All</button>
                {SKILL_CLIENT_CATEGORIES.map((item) => (
                    <button key={item.key} type="button" onClick={() => setCategory(item.key)} className={cn('whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium', category === item.key ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300')}>{item.name}</button>
                ))}
            </div>

            <div
                id={listboxId}
                role="listbox"
                aria-busy={loading}
                aria-label="Available skills"
                className="min-h-40 max-h-72 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
                {selectableResults.map((skill, index) => (
                        <button
                            id={`${listboxId}-option-${index}`}
                            key={skill.canonicalKey}
                            type="button"
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSkill(skill.name)}
                            className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', index === activeIndex ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/70')}
                        >
                            <SkillIcon skill={skill} size={20} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{skill.name}</span>
                                <span className="block truncate text-xs capitalize text-zinc-500">{skill.categoryKey.replaceAll('-', ' ')} · {skill.kind.replaceAll('-', ' ')}</span>
                            </span>
                        </button>
                ))}
                {canAddCustom ? (
                        <button
                            id={`${listboxId}-option-${selectableResults.length}`}
                            type="button"
                            role="option"
                            aria-selected={activeIndex === selectableResults.length}
                            onMouseEnter={() => setActiveIndex(selectableResults.length)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSkill(query.trim())}
                            className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', activeIndex === selectableResults.length ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/70')}
                        >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100"><Plus className="h-3.5 w-3.5" /></span>
                            <span><span className="block text-sm font-medium">Add “{query.trim()}”</span><span className="block text-xs text-zinc-500">Custom skill · submitted for catalog review</span></span>
                        </button>
                ) : null}
                {!loading && optionCount === 0 ? <p className="px-3 py-6 text-center text-sm text-zinc-500">No matching skills.</p> : null}
            </div>
        </div>
    )
}
