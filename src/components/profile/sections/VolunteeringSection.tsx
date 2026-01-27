"use client";

import { Heart, Calendar } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface VolunteeringSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function VolunteeringSection({ profile, isOwner }: VolunteeringSectionProps) {
    const volunteering: Array<{
        role: string;
        organization: string;
        start_date: string;
        end_date?: string;
        current: boolean;
    }> = [];

    return (
        <SectionCard
            title="Volunteering"
            icon={<Heart className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={volunteering.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Share your volunteer work and community involvement
                    </p>
                </div>
            }
        >
            {volunteering.length > 0 && (
                <div className="space-y-4">
                    {volunteering.map((vol, idx) => (
                        <div key={idx} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                            <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">{vol.role}</h3>
                            <p className="text-zinc-600 dark:text-zinc-400 mb-2">{vol.organization}</p>
                            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
                                <Calendar className="w-4 h-4" />
                                <span>
                                    {new Date(vol.start_date).toLocaleDateString()} -{" "}
                                    {vol.current ? "Present" : vol.end_date ? new Date(vol.end_date).toLocaleDateString() : ""}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
