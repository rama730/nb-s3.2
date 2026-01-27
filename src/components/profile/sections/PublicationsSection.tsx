"use client";

import { BookOpen } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface PublicationsSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function PublicationsSection({ profile, isOwner }: PublicationsSectionProps) {
    const publications: Array<{
        title: string;
        publisher: string;
        publication_date: string;
    }> = [];

    return (
        <SectionCard
            title="Publications"
            icon={<BookOpen className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={publications.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Share your research papers, articles, and publications
                    </p>
                </div>
            }
        >
            {publications.length > 0 && (
                <div className="space-y-4">
                    {publications.map((pub, idx) => (
                        <div key={idx} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                            <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">{pub.title}</h3>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">{pub.publisher}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-500">
                                {new Date(pub.publication_date).toLocaleDateString()}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
