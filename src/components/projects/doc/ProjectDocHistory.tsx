"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, GitCompareArrows, RotateCcw, Trash2 } from "lucide-react";

import type { ProjectDocVersion } from "@/lib/projects/doc";
import { cn } from "@/lib/utils";
import { StackedAvatars } from "@/components/ui/StackedAvatars";

export function ProjectDocHistory({
    versions,
    loading = false,
    onRestore,
    onDelete,
    onSetCurrent,
    onDiscardDraft,
    currentVersionId,
    draftContent = "",
}: {
    versions: ProjectDocVersion[];
    loading?: boolean;
    onRestore: (versionId: string) => void;
    onDelete: (versionId: string) => void;
    onSetCurrent: (versionId: string) => void;
    onDiscardDraft: () => void;
    currentVersionId?: string | null;
    draftContent?: string;
}) {
    const [comparisonVersionId, setComparisonVersionId] = useState<string | null>(null);
    const comparisonVersion = useMemo(
        () => versions.find((version) => version.id === comparisonVersionId) ?? null,
        [comparisonVersionId, versions],
    );

    if (loading) {
        return (
            <div className="grid gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
                ))}
            </div>
        );
    }

    if (!versions.length) {
        return (
            <div className="space-y-3">
                <button
                    type="button"
                    onClick={onDiscardDraft}
                    className="w-full rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-left text-sm font-semibold text-amber-800 transition hover:border-amber-300 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200"
                >
                    Discard current draft
                    <span className="mt-1 block text-xs font-medium opacity-80">Clear unpublished document work and return to an empty draft.</span>
                </button>
                <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
                    No published versions yet. Publish the first document to start history.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                Restore copies a version into draft. Set current changes the published document. Deleting the current version promotes the newest remaining version automatically.
            </div>
            <button
                type="button"
                onClick={onDiscardDraft}
                className="w-full rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-left text-sm font-semibold text-amber-800 transition hover:border-amber-300 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200"
            >
                Discard current draft
                <span className="mt-1 block text-xs font-medium opacity-80">Replace unpublished edits with the current published document.</span>
            </button>
            {comparisonVersion ? (
                <VersionComparison version={comparisonVersion} draftContent={draftContent} onClose={() => setComparisonVersionId(null)} />
            ) : null}
            {versions.map((version) => (
                <div key={version.id} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-zinc-950 dark:text-zinc-50">
                                    Version {version.displayVersionNumber ?? version.versionNumber}
                                </p>
                                {currentVersionId === version.id ? (
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600 dark:bg-blue-950/40 dark:text-blue-200">
                                        Current
                                    </span>
                                ) : null}
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                                    Score {version.qualityReport.score}
                                </span>
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                                    {formatBytes(version.qualityReport.contentBytes)}
                                </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                                <p className="text-sm text-zinc-500">
                                    {new Date(version.createdAt).toLocaleString()}
                                    {version.createdByName ? ` · Published by ${version.createdByName}` : null}
                                </p>
                                {version.coAuthors && version.coAuthors.length > 0 && (
                                    <>
                                        <span className="text-zinc-300 dark:text-zinc-700">&bull;</span>
                                        <div className="flex items-center gap-2">
                                            <StackedAvatars 
                                                avatars={version.coAuthors.map(c => ({ 
                                                    url: c.avatarUrl, 
                                                    initials: c.name?.charAt(0)?.toUpperCase() || 'U', 
                                                    name: c.name 
                                                }))} 
                                                size={20} 
                                                max={3} 
                                            />
                                            <span className="text-xs font-medium text-zinc-500">
                                                {version.coAuthors.length} co-author{version.coAuthors.length !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                            {version.changeSummary ? (
                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{version.changeSummary}</p>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            {currentVersionId !== version.id ? (
                                <button
                                    type="button"
                                    onClick={() => onSetCurrent(version.id)}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                                >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Set current
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => setComparisonVersionId((current) => current === version.id ? null : version.id)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                            >
                                <GitCompareArrows className="h-3.5 w-3.5" />
                                Compare
                            </button>
                            <button
                                type="button"
                                onClick={() => onRestore(version.id)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Restore
                            </button>
                            <button
                                type="button"
                                onClick={() => onDelete(version.id)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                                    "border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 dark:border-red-950 dark:text-red-300 dark:hover:bg-red-950/30",
                                )}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeLineDiff(versionContent: string, draftContent: string) {
    const normalize = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const versionLines = normalize(versionContent);
    const draftLines = normalize(draftContent);
    const versionSet = new Set(versionLines);
    const draftSet = new Set(draftLines);
    return {
        onlyVersion: versionLines.filter((line) => !draftSet.has(line)).length,
        onlyDraft: draftLines.filter((line) => !versionSet.has(line)).length,
        versionLines: versionLines.length,
        draftLines: draftLines.length,
    };
}

function VersionComparison({
    version,
    draftContent,
    onClose,
}: {
    version: ProjectDocVersion;
    draftContent: string;
    onClose: () => void;
}) {
    const diff = useMemo(() => summarizeLineDiff(version.content, draftContent), [draftContent, version.content]);

    return (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/70 dark:bg-blue-950/20" data-readme-version-comparison="true">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                        Draft compared with version {version.displayVersionNumber ?? version.versionNumber}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-200">
                        Draft has {diff.onlyDraft} changed lines. Version has {diff.onlyVersion} lines not in the draft.
                    </p>
                </div>
                <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900/40">
                    Close
                </button>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <pre className="max-h-60 overflow-auto rounded-xl bg-white p-3 text-xs leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{version.content.slice(0, 4000)}</pre>
                <pre className="max-h-60 overflow-auto rounded-xl bg-white p-3 text-xs leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{draftContent.slice(0, 4000)}</pre>
            </div>
        </div>
    );
}
