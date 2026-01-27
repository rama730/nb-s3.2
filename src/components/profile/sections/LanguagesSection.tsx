"use client";

import { Languages } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface LanguagesSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function LanguagesSection({ profile, isOwner }: LanguagesSectionProps) {
    const languages: Array<{
        name: string;
        proficiency?: string;
    }> = [];

    return (
        <SectionCard
            title="Languages"
            icon={<Languages className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={languages.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Add languages you speak
                    </p>
                </div>
            }
        >
            {languages.length > 0 && (
                <div className="flex flex-wrap gap-3">
                    {languages.map((lang, idx) => (
                        <div
                            key={idx}
                            className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50"
                        >
                            <span className="font-medium text-zinc-900 dark:text-white">{lang.name}</span>
                            {lang.proficiency && (
                                <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-500">
                                    ({lang.proficiency})
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
