"use client";

import { Award, ExternalLink } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Profile } from "@/lib/db/schema";

interface CertificationsSectionProps {
    profile: Profile;
    isOwner: boolean;
}

export default function CertificationsSection({ profile, isOwner }: CertificationsSectionProps) {
    const certifications: Array<{
        name: string;
        issuer: string;
        issue_date: string;
        credential_url?: string;
    }> = [];

    return (
        <SectionCard
            title="Certifications"
            icon={<Award className="w-5 h-5" />}
            isOwner={isOwner}
            onAdd={isOwner ? () => { } : undefined}
            isEmpty={certifications.length === 0}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Add professional certifications and credentials
                    </p>
                </div>
            }
        >
            {certifications.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {certifications.map((cert, idx) => (
                        <div
                            key={idx}
                            className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                        >
                            <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">{cert.name}</h3>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">{cert.issuer}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-3">
                                {new Date(cert.issue_date).toLocaleDateString()}
                            </p>
                            {cert.credential_url && (
                                <a
                                    href={cert.credential_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    View credential <ExternalLink className="w-3 h-3" />
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}
