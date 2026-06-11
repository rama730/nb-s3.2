"use client";

import { BookOpenText } from "lucide-react";

import { ProjectReadmeImportPicker } from "@/components/projects/readme/ProjectReadmeImportPicker";

export function ProjectReadmeEmptyState({
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
    if (!canEdit) return null;

    return (
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-dashed border-zinc-300 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                    <span className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                        <BookOpenText className="h-6 w-6" />
                    </span>
                    <div>
                        <p className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Project README</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                            Keep one canonical README for this project. Write from scratch or import an existing Markdown README from Files.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onCreate}
                    className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                    Create README
                </button>
            </div>
            <div className="mt-6">
                <ProjectReadmeImportPicker projectId={projectId} importing={importing} onImport={onImport} />
            </div>
        </div>
    );
}
