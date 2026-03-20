"use client";

import { FolderKanban, ExternalLink } from "lucide-react";
import SectionCard from "./SectionCard";
import Image from "next/image";
import type { Profile } from "@/lib/db/schema";

interface ProjectsSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function ProjectsSection({ profile, isOwner }: ProjectsSectionProps) {
    // Projects would come from our projects table in a full implementation
    const projects: Array<{
        title: string;
        role?: string;
        description?: string;
        image?: string;
        url?: string;
    }> = [];

    return (
        <SectionCard
            title="Projects"
            icon={<FolderKanban className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={projects.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Showcase your projects and work
                    </p>
                </div>
            }
        >
            {projects.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {projects.map((project, idx) => (
                        <div
                            key={idx}
                            className="group rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                        >
                            {project.image && (
                                <div className="relative h-32 app-accent-gradient">
                                    <Image
                                        src={project.image}
                                        alt={project.title}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                            )}
                            <div className="p-4">
                                <div className="flex items-start justify-between mb-2">
                                    <h3 className="font-semibold text-zinc-900 dark:text-white">{project.title}</h3>
                                    {project.role && (
                                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-primary/10 text-primary">
                                            {project.role}
                                        </span>
                                    )}
                                </div>
                                {project.description && (
                                    <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 mb-3">
                                        {project.description}
                                    </p>
                                )}
                                {project.url && (
                                    <a
                                        href={project.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                    >
                                        View project <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
