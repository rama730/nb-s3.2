'use client'

import { Briefcase } from 'lucide-react'
import { Card } from './Card'

interface ExperienceCardProps {
    experiences: any[]
    isOwner: boolean
    onAdd?: () => void
}

export function ExperienceCard({ experiences, isOwner, onAdd }: ExperienceCardProps) {
    return (
        <Card
            title="Experience"
            icon={<Briefcase className="w-5 h-5" />}
            onAdd={onAdd}
        >
            <div className="px-5 py-4 space-y-6">
                {experiences && experiences.length > 0 ? (
                    experiences.map((exp: any, i) => (
                        <div key={i} className="relative pl-6 border-l-2 border-zinc-100 dark:border-zinc-800 last:border-0 pb-1">
                            <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-white dark:border-zinc-900" />
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                                <div>
                                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{exp.title}</h4>
                                    <div className="text-sm text-zinc-700 dark:text-zinc-300">{exp.company}</div>
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap mt-1 sm:mt-0">
                                    {exp.startDate} - {exp.endDate || 'Present'}
                                </div>
                            </div>
                            {exp.description && (
                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                                    {exp.description}
                                </p>
                            )}
                        </div>
                    ))
                ) : (
                    <div className="text-center py-6">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {isOwner ? 'Add your work experience' : 'No experience listed'}
                        </p>
                    </div>
                )}
            </div>
        </Card>
    )
}
