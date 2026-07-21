'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { SkillSummary } from '@/lib/skills/types'
import { SkillChip } from './SkillChip'

export function SkillList({
    skills,
    maxVisible,
    size = 'md',
    layout = 'flex',
    className,
}: {
    skills: readonly (string | SkillSummary)[]
    maxVisible?: number
    size?: 'sm' | 'md' | 'lg'
    layout?: 'flex' | 'grid'
    className?: string
}) {
    const [expanded, setExpanded] = useState(false)
    const visible = maxVisible && !expanded ? skills.slice(0, maxVisible) : skills
    const remaining = Math.max(0, skills.length - visible.length)

    // Dynamic grid column configuration based on total skill count
    const colCount = layout === 'grid'
        ? (skills.length <= 6 ? 2 : skills.length <= 12 ? 3 : 4)
        : 1

    const gridColsClass = colCount === 2
        ? 'grid-cols-2'
        : colCount === 3
        ? 'grid-cols-3'
        : 'grid-cols-4'

    const colSpanClass = colCount === 2
        ? 'col-span-2'
        : colCount === 3
        ? 'col-span-3'
        : 'col-span-4'

    // Automatically use smaller chips in 3/4 column grids to maximize readability
    const resolvedSize = layout === 'grid' && colCount >= 3 ? 'sm' : size

    return (
        <div
            className={cn(
                layout === 'grid'
                    ? cn('grid gap-2 w-full', gridColsClass)
                    : 'flex flex-wrap gap-2',
                className
            )}
        >
            {visible.map((skill) => (
                <SkillChip
                    key={typeof skill === 'string' ? skill : skill.canonicalKey}
                    skill={skill}
                    size={resolvedSize}
                    variant="subtle"
                    className={cn(layout === 'grid' && 'w-full')}
                />
            ))}
            {remaining > 0 ? (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className={cn(
                        "rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none   dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                        layout === 'grid' && cn('w-full text-center justify-center', colSpanClass)
                    )}
                    aria-label={`Show ${remaining} more skills`}
                >
                    +{remaining}
                </button>
            ) : expanded && maxVisible && skills.length > maxVisible ? (
                <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className={cn(
                        "rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none   dark:text-zinc-300 dark:hover:bg-zinc-800",
                        layout === 'grid' && cn('w-full text-center justify-center', colSpanClass)
                    )}
                >
                    Show less
                </button>
            ) : null}
        </div>
    )
}
