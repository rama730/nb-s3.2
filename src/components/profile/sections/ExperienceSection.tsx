"use client";

import { Briefcase, Calendar } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface ExperienceSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function ExperienceSection({ profile, isOwner }: ExperienceSectionProps) {
    // Experience data would come from a separate table in a full implementation
    const experiences: Array<{
        title: string;
        company: string;
        start_date: string;
        end_date?: string;
        current: boolean;
        description?: string;
    }> = [];

    return (
        <SectionCard
            title="Experience"
            icon={<Briefcase className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={experiences.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Add your work experience to showcase your career journey
                    </p>
                </div>
            }
        >
            {experiences.length > 0 && (
                <div className="space-y-6">
                    {experiences.map((exp, idx) => (
                        <div key={idx} className="relative pl-8 pb-6 last:pb-0">
                            {/* Timeline */}
                            <div className="absolute left-0 top-2 bottom-0 w-0.5 bg-zinc-200 dark:bg-zinc-800" />
                            <div className="absolute left-0 top-2 w-3 h-3 rounded-full bg-blue-600 dark:bg-blue-400 -translate-x-1.5" />

                            <div className="space-y-2">
                                <div>
                                    <h3 className="font-semibold text-zinc-900 dark:text-white">{exp.title}</h3>
                                    <p className="text-zinc-600 dark:text-zinc-400">{exp.company}</p>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
                                    <Calendar className="w-4 h-4" />
                                    <span>
                                        {new Date(exp.start_date).toLocaleDateString()} -{" "}
                                        {exp.current ? "Present" : exp.end_date ? new Date(exp.end_date).toLocaleDateString() : ""}
                                    </span>
                                </div>
                                {exp.description && (
                                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                                        {exp.description}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
