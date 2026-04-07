'use client'

import { Star, ExternalLink } from 'lucide-react'
import { Card } from './Card'
import Image from 'next/image'
import Link from 'next/link'
import { normalizeProjectDescription, normalizeProjectTitle } from '@/lib/profile/display'

interface FeaturedProjectsCardProps {
    projects: any[]
    isOwner: boolean
}

export function FeaturedProjectsCard({ projects, isOwner }: FeaturedProjectsCardProps) {
    // Heuristic (no DB changes): show the top 2 projects as provided by server ordering.
    const featured = (projects || []).slice(0, 2)

    if (!featured.length && !isOwner) return null

    return (
        <Card
            title="Featured Projects"
            icon={<Star className="w-5 h-5 text-amber-500" />}
        >
            <div className="px-5 py-4">
                {featured.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {featured.map((project, idx) => {
                            const title = normalizeProjectTitle(project?.title)
                            const description = normalizeProjectDescription(project?.shortDescription, project?.description)
                            return (
                            <Link
                                key={project?.id ?? idx}
                                href={project?.slug ? `/projects/${project.slug}` : `/projects/${project?.id ?? ''}`}
                                className="group rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-md transition-all bg-zinc-50 dark:bg-zinc-900/50 block"
                            >
                                {project?.coverImage ? (
                                    <div className="relative h-32 w-full">
                                        <Image
                                            src={project.coverImage}
                                            alt={title}
                                            fill
                                            className="object-cover"
                                            sizes="(max-width: 768px) 100vw, 420px"
                                        />
                                    </div>
                                ) : (
                                    <div className="h-32 w-full bg-[linear-gradient(135deg,color-mix(in_oklch,var(--theme-gradient-start)_12%,transparent),color-mix(in_oklch,var(--theme-gradient-end)_12%,transparent))] flex items-center justify-center">
                                        <Star className="w-8 h-8 text-primary/30" />
                                    </div>
                                )}
                                <div className="p-4">
                                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 line-clamp-1">{title}</h3>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-3">
                                        {description}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                                            Open <ExternalLink className="w-3 h-3" />
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        )})}
                    </div>
                ) : (
                    <div className="text-center py-8 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                        <Link href="/projects/new" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                            Add a project to your portfolio
                        </Link>
                    </div>
                )}
            </div>
        </Card>
    )
}
