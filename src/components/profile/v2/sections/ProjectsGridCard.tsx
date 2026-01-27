'use client'

import { FolderKanban, Star } from 'lucide-react'
import Image from 'next/image'

interface ProjectsGridCardProps {
    projects: any[]
    title?: string
    description?: string
}

export function ProjectsGridCard({ projects, title = 'Projects', description }: ProjectsGridCardProps) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
                    {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
                </div>
            </div>

            {projects && projects.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((project, idx) => (
                        <div
                            key={idx}
                            className="group flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden hover:shadow-lg transition-all duration-300"
                        >
                            <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                                {project.image ? (
                                    <Image
                                        src={project.image}
                                        alt={project.title}
                                        fill
                                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-zinc-300 dark:text-zinc-700">
                                        <FolderKanban className="w-12 h-12" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 p-5 flex flex-col">
                                <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 mb-2">
                                    {project.title}
                                </h3>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-4 flex-1">
                                    {project.description || 'No description'}
                                </p>
                                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                                    <div className="flex -space-x-2">
                                        {/* Contributors stub */}
                                        <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-white dark:border-zinc-900" />
                                        <div className="w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 border-2 border-white dark:border-zinc-900" />
                                    </div>
                                    <a
                                        href={project.url || '#'}
                                        className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                    >
                                        View Details
                                    </a>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-12 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                    <FolderKanban className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-700 mb-4" />
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">No projects yet</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Projects you create or contribute to will appear here.
                    </p>
                </div>
            )}
        </div>
    )
}
