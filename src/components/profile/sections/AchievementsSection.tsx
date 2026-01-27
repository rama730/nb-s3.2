"use client";

import { Trophy } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface AchievementsSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function AchievementsSection({ profile, isOwner }: AchievementsSectionProps) {
    const achievements: Array<{
        title: string;
        issuer: string;
        date: string;
    }> = [];

    return (
        <SectionCard
            title="Achievements & Awards"
            icon={<Trophy className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={achievements.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Showcase your achievements, awards, and recognitions
                    </p>
                </div>
            }
        >
            {achievements.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {achievements.map((achievement, idx) => (
                        <div
                            key={idx}
                            className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 hover:shadow-md transition-all duration-300"
                        >
                            <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">
                                {achievement.title}
                            </h3>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">{achievement.issuer}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-500">
                                {new Date(achievement.date).toLocaleDateString()}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
