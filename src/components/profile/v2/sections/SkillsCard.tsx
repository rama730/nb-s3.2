'use client'

import { Wrench } from 'lucide-react'
import { Card } from './Card'

interface SkillsCardProps {
    skills: string[]
    isOwner: boolean
    onAdd?: () => void
}

export function SkillsCard({ skills, isOwner, onAdd }: SkillsCardProps) {
    return (
        <Card
            title="Skills"
            icon={<Wrench className="w-5 h-5" />}
            onAdd={onAdd}
            addLabel="Add skills"
        >
            <div className="px-5 py-4">
                {skills && skills.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {skills.map((skill) => (
                            <span
                                key={skill}
                                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300 font-medium"
                            >
                                {skill}
                            </span>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-6">
                        {isOwner && onAdd ? (
                            <button
                                type="button"
                                onClick={onAdd}
                                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                            >
                                Add skills to your profile
                            </button>
                        ) : (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">No skills listed</p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    )
}
