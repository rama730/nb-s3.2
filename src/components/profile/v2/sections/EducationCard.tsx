'use client'

import { GraduationCap } from 'lucide-react'
import { Card } from './Card'

interface EducationCardProps {
    education: any[]
    isOwner: boolean
    onAdd?: () => void
}

export function EducationCard({ education, isOwner, onAdd }: EducationCardProps) {
    return (
        <Card
            title="Education"
            icon={<GraduationCap className="w-5 h-5" />}
            onAdd={onAdd}
            addLabel="Add education"
        >
            <div className="px-5 py-4 space-y-6">
                {education && education.length > 0 ? (
                    education.map((edu: any, i) => (
                        <div key={i} className="flex gap-4">
                            <div className="w-12 h-12 rounded-lg bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                                <GraduationCap className="w-6 h-6 text-zinc-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{edu.school}</h4>
                                <div className="text-sm text-zinc-700 dark:text-zinc-300">{edu.degree}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    {edu.startDate} - {edu.endDate || 'Present'}
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center py-6">
                        {isOwner && onAdd ? (
                            <button
                                type="button"
                                onClick={onAdd}
                                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                            >
                                Add your education
                            </button>
                        ) : (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">No education listed</p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    )
}
