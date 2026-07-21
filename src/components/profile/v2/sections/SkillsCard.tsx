'use client'

import { Wrench } from 'lucide-react'
import { Card } from './Card'
import { SkillList } from '@/components/skills/SkillList'

interface SkillsCardProps {
    skills: string[]
    isOwner: boolean
    onAdd?: () => void
    variant?: 'default' | 'rail'
}

export function SkillsCard({ skills, isOwner, onAdd, variant = 'default' }: SkillsCardProps) {
    if ((!skills || skills.length === 0) && !isOwner) return null

    return (
        <Card
            title="Skills"
            icon={<Wrench className="w-5 h-5" />}
            onAdd={onAdd}
            addLabel="Add skills"
            density={variant === 'rail' ? 'compact' : 'default'}
        >
            <div className="px-5 py-4">
                {skills && skills.length > 0 ? (
                    <SkillList skills={skills} maxVisible={12} layout={variant === 'rail' ? 'grid' : 'flex'} />
                ) : (
                    <div className={variant === 'rail' ? 'py-2' : 'text-center py-6'}>
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
