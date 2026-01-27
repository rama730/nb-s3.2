"use client";

import { User } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface BioSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function BioSection({ profile, isOwner }: BioSectionProps) {
    const hasBio = profile?.bio && profile.bio.trim().length > 0;

    return (
        <SectionCard
            title="About"
            icon={<User className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={!hasBio}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Add a bio to tell others about yourself
                    </p>
                </div>
            }
        >
            {hasBio && (
                <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {profile.bio}
                </p>
            )}
        </SectionCard>
    );
}
