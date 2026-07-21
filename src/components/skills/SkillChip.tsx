'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveClientSkill } from '@/lib/skills/client'
import type { SkillSummary } from '@/lib/skills/types'
import { SkillIcon } from './SkillIcon'

function skillSummary(input: SkillSummary | string) {
    return typeof input === 'string' ? resolveClientSkill(input) : input
}

export function SkillChip({
    skill: input,
    size = 'md',
    variant = 'default',
    onRemove,
    selected = false,
    className,
}: {
    skill: SkillSummary | string
    size?: 'sm' | 'md' | 'lg'
    variant?: 'default' | 'subtle' | 'required' | 'preferred'
    onRemove?: () => void
    selected?: boolean
    className?: string
}) {
    const skill = skillSummary(input)
    const name = skill.name
    const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16

    return (
        <span
            className={cn(
                'inline-flex max-w-full items-center rounded-lg border font-medium transition-colors',
                size === 'sm' && 'gap-1.5 px-2 py-1 text-xs',
                size === 'md' && 'gap-2 px-2.5 py-1.5 text-sm',
                size === 'lg' && 'gap-2.5 px-3 py-2 text-sm',
                variant === 'default' && 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200',
                variant === 'subtle' && 'border-transparent bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
                variant === 'required' && 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
                variant === 'preferred' && 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
                selected && 'border-blue-500 ring-2 ring-blue-500/20',
                className,
            )}
            data-skill-key={skill.canonicalKey}
            title={skill.status === 'deprecated' ? `${skill.name} is deprecated` : undefined}
        >
            <SkillIcon skill={skill} size={iconSize} />
            <span className="truncate">{name}</span>
            {onRemove ? (
                <button
                    type="button"
                    onClick={onRemove}
                    className="-mr-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-black/5 hover:text-red-600 focus-visible:outline-none   dark:hover:bg-white/10"
                    aria-label={`Remove ${name}`}
                >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            ) : null}
        </span>
    )
}
