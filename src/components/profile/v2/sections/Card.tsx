'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'

interface CardProps {
    title: string
    icon?: React.ReactNode
    children?: React.ReactNode
    className?: string
    action?: React.ReactNode
    onAdd?: () => void
    addLabel?: string
    density?: 'default' | 'compact'
    id?: string
}

export function Card({ title, icon, children, className, action, onAdd, addLabel, density = 'default', id }: CardProps) {
    const headingId = useId()
    return (
        <section
            aria-labelledby={headingId}
            id={id}
            className={cn('rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm', className)}
        >
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {icon ? <span className="text-zinc-500 dark:text-zinc-400">{icon}</span> : null}
                    <h2 id={headingId} className={cn("font-semibold text-zinc-900 dark:text-zinc-100", density === 'compact' ? 'text-sm' : 'text-lg')}>{title}</h2>
                </div>
                <div className="flex items-center gap-2">
                    {action}
                    {onAdd && (
                        <button
                            type="button"
                            onClick={onAdd}
                            aria-label={addLabel || `Add ${title.toLowerCase()}`}
                            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
                        >
                            <Plus className="w-5 h-5" aria-hidden="true" />
                        </button>
                    )}
                </div>
            </div>
            <div className="p-0">{children}</div>
        </section>
    )
}
