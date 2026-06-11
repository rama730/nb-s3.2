"use client";

import { useMemo, useState } from "react";
import { Check, GitMerge, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

type ReadmeSectionChoice = "local" | "server";

type ReadmeSection = {
    key: string;
    title: string;
    local: string;
    server: string;
    localLineCount: number;
    serverLineCount: number;
};

function splitReadmeSections(local: string, server: string): ReadmeSection[] {
    const split = (value: string) => {
        const sections: Array<{ title: string; body: string }> = [];
        const lines = value.split("\n");
        let currentTitle = "Opening";
        let currentLines: string[] = [];
        const flush = () => {
            sections.push({ title: currentTitle, body: currentLines.join("\n").trimEnd() });
        };
        lines.forEach((line) => {
            const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
            if (heading) {
                flush();
                currentTitle = heading[2] || "Section";
                currentLines = [line];
                return;
            }
            currentLines.push(line);
        });
        flush();
        return sections.filter((section) => section.body.trim().length > 0);
    };

    const localSections = split(local);
    const serverSections = split(server);
    const titles = new Set([...localSections.map((section) => section.title), ...serverSections.map((section) => section.title)]);
    return Array.from(titles).map((title, index) => ({
        key: `${title}:${index}`,
        title,
        local: localSections.find((section) => section.title === title)?.body ?? "",
        server: serverSections.find((section) => section.title === title)?.body ?? "",
        localLineCount: (localSections.find((section) => section.title === title)?.body ?? "").split("\n").filter(Boolean).length,
        serverLineCount: (serverSections.find((section) => section.title === title)?.body ?? "").split("\n").filter(Boolean).length,
    }));
}

function buildMergedContent(sections: ReadmeSection[], choices: Record<string, ReadmeSectionChoice>) {
    return sections
        .map((section) => choices[section.key] === "server" ? section.server : section.local)
        .filter((value) => value.trim().length > 0)
        .join("\n\n")
        .trim();
}

export function ProjectReadmeConflictResolver({
    localContent,
    serverContent,
    onKeepLocal,
    onUseLatest,
    onApplyMerged,
}: {
    localContent: string;
    serverContent: string;
    onKeepLocal: () => void;
    onUseLatest: () => void;
    onApplyMerged: (content: string) => void;
}) {
    const sections = useMemo(() => splitReadmeSections(localContent, serverContent), [localContent, serverContent]);
    const [choices, setChoices] = useState<Record<string, ReadmeSectionChoice>>(() => (
        Object.fromEntries(sections.map((section) => [section.key, "local" as const]))
    ));
    const mergedContent = useMemo(() => buildMergedContent(sections, choices), [choices, sections]);

    const choose = (sectionKey: string, choice: ReadmeSectionChoice) => {
        setChoices((current) => ({ ...current, [sectionKey]: choice }));
    };

    return (
        <section className="space-y-4 border-b border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100" data-readme-conflict-resolver="true">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <GitMerge className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                        <p className="text-sm font-semibold">README draft changed in another session.</p>
                        <p className="mt-0.5 text-xs leading-5 opacity-85">
                            Choose the local or server version per section, then apply the merged draft.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={onUseLatest} className="inline-flex items-center gap-1.5 rounded-full border border-current/20 px-3 py-1.5 text-xs font-semibold">
                        <RotateCcw className="h-3.5 w-3.5" />
                        Load latest
                    </button>
                    <button type="button" onClick={onKeepLocal} className="rounded-full border border-current/20 px-3 py-1.5 text-xs font-semibold">
                        Keep my draft
                    </button>
                    <button type="button" onClick={() => onApplyMerged(mergedContent)} className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">
                        <Check className="h-3.5 w-3.5" />
                        Apply merged
                    </button>
                </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
                {sections.map((section) => {
                    const same = section.local === section.server;
                    return (
                        <div key={section.key} className="rounded-2xl border border-amber-200 bg-white/70 p-3 dark:border-amber-900/70 dark:bg-zinc-950/60" data-readme-conflict-section-diff="true">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">{section.title}</p>
                                <div className="flex shrink-0 items-center gap-1">
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                                        {section.localLineCount}/{section.serverLineCount} lines
                                    </span>
                                    {same ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Same</span> : null}
                                </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {(["local", "server"] as const).map((choice) => (
                                    <button
                                        key={choice}
                                        type="button"
                                        onClick={() => choose(section.key, choice)}
                                        className={cn(
                                            "min-h-28 rounded-xl border p-2 text-left transition",
                                            choices[section.key] === choice
                                                ? "border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-600 dark:bg-blue-950/40 dark:text-blue-100"
                                                : "border-zinc-200 bg-white text-zinc-700 hover:border-blue-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
                                        )}
                                    >
                                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">{choice === "local" ? "My draft" : "Latest server"}</span>
                                        <span className="line-clamp-6 whitespace-pre-wrap break-words text-xs leading-5 [overflow-wrap:anywhere]">
                                            {(choice === "local" ? section.local : section.server) || "No content in this section."}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
