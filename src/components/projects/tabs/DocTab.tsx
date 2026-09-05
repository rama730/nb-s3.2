"use client";

import { useMemo } from "react";
import { BookOpenText } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { ProjectDocViewer } from "@/components/projects/doc/ProjectDocViewer";
import { SkeletonDoc } from "@/components/projects/skeletons/SkeletonDoc";
import { useProjectDoc, useProjectMarkdowns } from "@/hooks/hub/useProjectDocData";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import type { Project } from "@/types/hub";

export default function DocTab({
    projectId,
    project,
}: {
    projectId: string;
    project: Project;
}) {
    const searchParams = useSearchParams();
    const paramDoc = searchParams?.get("doc");
    const markdownsQuery = useProjectMarkdowns(projectId, !paramDoc);
    const markdowns = markdownsQuery.data || [];
    const defaultDocSlug = useMemo(() => {
        if (paramDoc) return paramDoc;
        if (markdowns.length === 0) return "readme";
        const hasReadme = markdowns.some((m) => m.slug === "readme");
        if (hasReadme) return "readme";
        return markdowns[0]?.slug || "readme";
    }, [markdowns, paramDoc]);

    const rawDocSlug = paramDoc || defaultDocSlug;
    const docSlug = useMemo(() => normalizeProjectDocSlug(rawDocSlug), [rawDocSlug]);

    const readmeQuery = useProjectDoc(projectId, docSlug);

    if (readmeQuery.isLoading) return <SkeletonDoc />;

    if (readmeQuery.data?.version) {
        return (
            <ProjectDocViewer
                key={`${projectId}:${docSlug}:${readmeQuery.data.version.id}`}
                project={project}
                payload={readmeQuery.data}
                docSlug={docSlug}
            />
        );
    }

    return (
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <BookOpenText className="mx-auto h-8 w-8 text-zinc-400" />
            <p className="mt-4 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Document unavailable
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
                This project has not published a document that is visible to you.
            </p>
        </div>
    );
}
