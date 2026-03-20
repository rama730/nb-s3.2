"use client";

import { Star, ExternalLink } from "lucide-react";
import SectionCard from "./SectionCard";
import Image from "next/image";
import type { Profile } from "@/lib/db/schema";

interface FeaturedSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function FeaturedSection({ profile, isOwner }: FeaturedSectionProps) {
    // Featured items would come from a separate table/field
    const featuredItems: Array<{
        title: string;
        description?: string;
        image?: string;
        url?: string;
    }> = [];

    return (
        <SectionCard
            title="Featured"
            icon={<Star className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={featuredItems.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Pin your best work, posts, or links to the top of your profile
                    </p>
                </div>
            }
        >
            {featuredItems.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {featuredItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="group relative rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                        >
                            {item.image && (
                                <div className="relative h-32 app-accent-gradient">
                                    <Image
                                        src={item.image}
                                        alt={item.title}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                            )}
                            <div className="p-4">
                                <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">{item.title}</h3>
                                {item.description && (
                                    <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 mb-2">
                                        {item.description}
                                    </p>
                                )}
                                {item.url && (
                                    <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                    >
                                        View <ExternalLink className="w-3 h-3" />
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
