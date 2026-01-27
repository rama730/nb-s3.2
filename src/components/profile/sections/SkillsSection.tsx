"use client";

import { Code, Star } from "lucide-react";
import SectionCard from "./SectionCard";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/db/schema";

interface SkillsSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function SkillsSection({ profile, isOwner }: SkillsSectionProps) {
    const skills = (profile?.skills as string[]) || [];
    const featuredSkills = skills.slice(0, 5);

    return (
        <SectionCard
            title="Skills"
            icon={<Code className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={skills.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Showcase your technical and professional skills
                    </p>
                </div>
            }
        >
            {skills.length > 0 && (
                <div className="space-y-6">
                    {/* Featured Skills */}
                    {featuredSkills.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Top Skills</h3>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {featuredSkills.map((skill, idx) => (
                                    <span
                                        key={idx}
                                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-700 dark:text-blue-300 font-semibold text-sm border border-blue-200 dark:border-blue-800"
                                    >
                                        {skill}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* All Skills */}
                    {skills.length > 5 && (
                        <div className="flex flex-wrap gap-2">
                            {skills.slice(5).map((skill, idx) => (
                                <span
                                    key={idx}
                                    className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                >
                                    {skill}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </SectionCard>
    );
}
