"use client";

import { useMemo, useState } from "react";
import { Check, FileText, Palette } from "lucide-react";

import {
    buildProjectReadmeStylePresetMarkdown,
    PROJECT_README_STYLE_PRESETS,
    type ProjectReadmeStylePresetId,
} from "@/lib/projects/readme-style";
import { cn } from "@/lib/utils";

export function ProjectReadmeStyleBuilder({
    projectName,
    onInsert,
    onClose,
}: {
    projectName: string;
    onInsert: (markdown: string) => void;
    onClose: () => void;
}) {
    const [selectedPreset, setSelectedPreset] = useState<ProjectReadmeStylePresetId>("open_source");
    const markdown = useMemo(
        () => buildProjectReadmeStylePresetMarkdown(selectedPreset, projectName),
        [projectName, selectedPreset],
    );

    return (
        <div className="space-y-4" data-readme-style-builder="true">
            <div className="flex items-start gap-3">
                <span className="rounded-2xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                    <Palette className="h-4 w-4" />
                </span>
                <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Choose a README style</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Insert a portable Markdown structure that matches the project purpose, then edit the copy in place.
                    </p>
                </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2" data-readme-style-presets="true">
                {PROJECT_README_STYLE_PRESETS.map((preset) => {
                    const active = preset.id === selectedPreset;
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            onClick={() => setSelectedPreset(preset.id)}
                            className={cn(
                                "rounded-2xl border p-3 text-left transition",
                                active
                                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-200"
                                    : "border-zinc-200 hover:border-blue-300 dark:border-zinc-800 dark:hover:border-blue-800",
                            )}
                        >
                            <span className="flex items-center gap-2 text-sm font-semibold">
                                <FileText className="h-4 w-4" />
                                {preset.label}
                            </span>
                            <span className="mt-1 block text-xs leading-5 opacity-80">{preset.description}</span>
                            <span className="mt-2 block text-xs text-zinc-500 dark:text-zinc-400">
                                {preset.sections.join(" / ")}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Preview</p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                    {markdown}
                </pre>
            </div>

            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={() => onInsert(`\n${markdown.trim()}\n`)}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                    <Check className="h-3.5 w-3.5" />
                    Insert style
                </button>
            </div>
        </div>
    );
}
