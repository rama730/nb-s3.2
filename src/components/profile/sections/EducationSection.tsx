"use client";

import { GraduationCap, Calendar } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface EducationSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function EducationSection({ profile, isOwner }: EducationSectionProps) {
    // Education data would come from a separate table in a full implementation
    const education: Array<{
        degree: string;
        institution: string;
        field?: string;
        start_date: string;
        end_date?: string;
    }> = [];

    return (
        <SectionCard
            title="Education"
            icon={<GraduationCap className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={education.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Add your educational background
                    </p>
                </div>
            }
        >
            {education.length > 0 && (
                <div className="space-y-6">
                    {education.map((edu, idx) => (
                        <div key={idx} className="space-y-2">
                            <div>
                                <h3 className="font-semibold text-zinc-900 dark:text-white">{edu.degree}</h3>
                                <p className="text-zinc-600 dark:text-zinc-400">{edu.institution}</p>
                                {edu.field && <p className="text-sm text-zinc-500 dark:text-zinc-500">{edu.field}</p>}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
                                <Calendar className="w-4 h-4" />
                                <span>
                                    {new Date(edu.start_date).toLocaleDateString()} -{" "}
                                    {edu.end_date ? new Date(edu.end_date).toLocaleDateString() : "Present"}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
