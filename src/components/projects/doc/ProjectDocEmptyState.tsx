"use client";

import { BookOpenText, Sparkles, X } from "lucide-react";
import { useState, useEffect } from "react";

import { ProjectDocImportPicker } from "@/components/projects/doc/ProjectDocImportPicker";

export function ProjectDocEmptyState({
    canEdit,
    projectId,
    importing,
    onCreate,
    onImport,
}: {
    canEdit: boolean;
    projectId: string;
    importing?: boolean;
    onCreate: () => void;
    onImport: (nodeId: string) => void;
}) {
    const [isDismissed, setIsDismissed] = useState(true);

    useEffect(() => {
        const dismissed = localStorage.getItem("docs_hub:dismissed_link_tip") === "true";
        setIsDismissed(dismissed);
    }, []);

    const handleDismiss = () => {
        localStorage.setItem("docs_hub:dismissed_link_tip", "true");
        setIsDismissed(true);
    };

    if (!canEdit) return null;

    return (
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-dashed border-zinc-300 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                    <span className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                        <BookOpenText className="h-6 w-6" />
                    </span>
                    <div>
                        <p className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Project Document</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                            Keep one canonical document for this project. Write from scratch or import an existing Markdown document from Files.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onCreate}
                    className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                    Create Document
                </button>
            </div>

            {!isDismissed && (
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20 relative">
                    <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div className="flex-1 pr-6">
                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">Did you know?</p>
                        <p className="mt-1 text-xs leading-normal text-blue-800/80 dark:text-blue-300/80">
                            You can link any existing Markdown file (.md) from your repository to make it a project document. Simply open it in the <span className="font-semibold">Files</span> tab and click <span className="font-semibold">"Link to Doc"</span> at the top.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="absolute right-3 top-3 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200"
                        title="Dismiss tip"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="mt-6">
                <ProjectDocImportPicker projectId={projectId} importing={importing} onImport={onImport} />
            </div>
        </div>
    );
}
