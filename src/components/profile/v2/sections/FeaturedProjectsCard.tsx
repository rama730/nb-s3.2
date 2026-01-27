'use client'

import { Star, ExternalLink } from 'lucide-react'
import { Card } from './Card'
import Image from 'next/image'

interface FeaturedProjectsCardProps {
    projects: any[]
    isOwner: boolean
}

export function FeaturedProjectsCard({ projects, isOwner }: FeaturedProjectsCardProps) {
    // Filter featured projects if we had a featured flag, taking first 2 for now
    const featured = projects.slice(0, 2)

    if (!featured.length && !isOwner) return null

    return (
        <Card
            title="Featured Projects"
            icon={<Star className="w-5 h-5 text-amber-500" />}
            onAdd={isOwner ? () => { } : undefined}
        >
            <div className="px-5 py-4">
                {featured.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {featured.map((project, idx) => (
                            <div
                                key={idx}
                                className="group rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-md transition-all bg-zinc-50 dark:bg-zinc-900/50"
                            >
                                {project.image ? (
                                    <div className="relative h-32 w-full">
                                        <Image
                                            src={project.image}
                                            alt={project.title}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                ) : (
                                    <div className="h-32 w-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 flex items-center justify-center">
                                        <Star className="w-8 h-8 text-indigo-500/20" />
                                    </div>
                                )}
                                <div className="p-4">
                                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 line-clamp-1">{project.title}</h4>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-3">
                                        {project.description || 'No description provided'}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {project.url && (
                                            <a
                                                href={project.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                                            >
                                                View <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            Feature your best work here
                        </p>
                    </div>
                )}
            </div>
        </Card>
    )
}
