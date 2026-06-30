"use client";

import { useDeferredValue, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";

import { ProjectDocReferenceOptionCard } from "@/components/projects/doc/ProjectDocReferencePreview";
import { useProjectDocImportCandidates } from "@/hooks/hub/useProjectDocData";
import type { ProjectDocReferenceOption } from "@/lib/projects/doc-blocks";

export function ProjectDocImportPicker({
    projectId,
    importing,
    onImport,
}: {
    projectId: string;
    importing?: boolean;
    onImport: (nodeId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const candidatesQuery = useProjectDocImportCandidates(projectId, deferredQuery, Boolean(projectId));

    const candidates = candidatesQuery.data ?? [];

    return (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
            <div className="flex items-start gap-2">
                <span className="rounded-xl bg-blue-500/10 p-2 text-blue-500">
                    <FileText className="h-4 w-4" />
                </span>
                <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Use existing document from Files</p>
                    <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                        Choose a Markdown file (.md, .mdx, .markdown) or similar text file. It imports as a private draft first.
                    </p>
                </div>
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                <Search className="h-4 w-4 text-zinc-400" />
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search README.md, docs.mdx, install notes..."
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
                />
            </label>
            <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1">
                {candidatesQuery.isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                    ))
                ) : candidatesQuery.error ? (
                    <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-300">
                        Failed to load document files.
                    </p>
                ) : candidates.length ? (
                    candidates.map((candidate: ProjectDocReferenceOption) => (
                        <button
                            key={candidate.id}
                            type="button"
                            disabled={importing}
                            onClick={() => onImport(candidate.id)}
                            className="text-left disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <ProjectDocReferenceOptionCard option={candidate} />
                        </button>
                    ))
                ) : (
                    <p className="rounded-xl border border-dashed border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-800">
                        No document files found yet. Upload or create a Markdown file in Files, then return here.
                    </p>
                )}
            </div>
            {importing ? (
                <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Importing selected document
                </p>
            ) : null}
        </div>
    );
}
