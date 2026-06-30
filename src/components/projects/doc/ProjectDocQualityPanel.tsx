"use client";

import { AlertTriangle, CheckCircle2, FileText, ImagePlus, PlayCircle, ShieldAlert, Wrench } from "lucide-react";

import type { ProjectDocQualityIssue, ProjectDocQualityReport } from "@/lib/projects/doc";
import { cn } from "@/lib/utils";

const SECTION_FIXES: Record<string, {
    label: string;
    markdown: string;
    icon: typeof FileText;
}> = {
    "missing-overview": {
        label: "Add overview",
        markdown: "\n## Overview\n\nExplain what this project does, who it helps, and why it matters.\n",
        icon: FileText,
    },
    "missing-setup": {
        label: "Add setup",
        markdown: "\n## Getting Started\n\n```bash\npnpm install\npnpm dev\n```\n",
        icon: Wrench,
    },
    "missing-usage": {
        label: "Add usage",
        markdown: "\n## Usage\n\nDescribe the main workflow and what readers should try first.\n",
        icon: PlayCircle,
    },
    "missing-demo": {
        label: "Add demo section",
        markdown: "\n## Demo\n\nAdd a screenshot, GIF, or short walkthrough here.\n",
        icon: ImagePlus,
    },
    "missing-contributing": {
        label: "Add collaboration guide",
        markdown: "\n## Contributing\n\nExplain how collaborators can join, pick work, or ask questions.\n",
        icon: CheckCircle2,
    },
    "missing-command": {
        label: "Add command block",
        markdown: "\n```bash\npnpm install\npnpm dev\n```\n",
        icon: Wrench,
    },
};

function issueTone(issue: ProjectDocQualityIssue) {
    if (issue.severity === "error") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/20 dark:text-red-300";
    if (issue.severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200";
    return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400";
}

function scoreTone(score: number) {
    if (score >= 85) return "text-emerald-600 dark:text-emerald-300";
    if (score >= 65) return "text-amber-600 dark:text-amber-300";
    return "text-red-600 dark:text-red-300";
}

export function ProjectDocQualityPanel({
    report,
    onInsertFix,
    onJumpToSection,
}: {
    report: ProjectDocQualityReport;
    onInsertFix: (markdown: string) => void;
    onJumpToSection: (issueId: string) => void;
}) {
    const blockingIssues = report.issues.filter((issue) => issue.severity === "error");
    const visualIssues = report.issues.filter((issue) => issue.severity !== "error" && (issue.id.startsWith("image-") || issue.id === "external-image"));
    const improvementIssues = report.issues.filter((issue) => (
        issue.severity !== "error"
        && !issue.id.startsWith("image-")
        && issue.id !== "external-image"
    ));
    const sizeKb = Math.max(1, Math.round(report.contentBytes / 1024));

    return (
        <section className="space-y-4" aria-label="Document quality report" data-readme-quality-panel="true" data-readme-visual-quality-panel="true">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Readiness</p>
                        <p className={cn("mt-1 text-3xl font-bold", scoreTone(report.score))}>{report.score}</p>
                    </div>
                    <div className="text-right text-xs leading-5 text-zinc-500">
                        <p>{sizeKb} KB</p>
                        <p>{blockingIssues.length} blocking</p>
                        <p>{improvementIssues.length} suggestions</p>
                    </div>
                </div>
            </div>

            {blockingIssues.length ? (
                <div className="space-y-2">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-500">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Fix before publishing
                    </p>
                    {blockingIssues.map((issue) => (
                        <IssueCard key={issue.id} issue={issue} onInsertFix={onInsertFix} onJumpToSection={onJumpToSection} />
                    ))}
                </div>
            ) : null}

            {visualIssues.length ? (
                <div className="space-y-2">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-500">
                        <ImagePlus className="h-3.5 w-3.5" />
                        Visual media
                    </p>
                    {visualIssues.map((issue) => (
                        <IssueCard key={issue.id} issue={issue} onInsertFix={onInsertFix} onJumpToSection={onJumpToSection} />
                    ))}
                </div>
            ) : null}

            <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Improvements
                </p>
                {improvementIssues.length ? improvementIssues.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} onInsertFix={onInsertFix} onJumpToSection={onJumpToSection} />
                )) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-300">
                        Document has the main sections and no known blocking issues.
                    </div>
                )}
            </div>
        </section>
    );
}

function IssueCard({
    issue,
    onInsertFix,
    onJumpToSection,
}: {
    issue: ProjectDocQualityIssue;
    onInsertFix: (markdown: string) => void;
    onJumpToSection: (issueId: string) => void;
}) {
    const fix = SECTION_FIXES[issue.id];
    const Icon = fix?.icon ?? AlertTriangle;
    return (
        <div className={cn("rounded-2xl border px-3 py-2", issueTone(issue))}>
            <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{issue.label}</p>
                    <p className="mt-1 text-xs leading-5 opacity-85">{issue.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {fix ? (
                            <button
                                type="button"
                                onClick={() => onInsertFix(fix.markdown)}
                                className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-white dark:bg-zinc-950/70 dark:text-zinc-200"
                            >
                                {fix.label}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => onJumpToSection(issue.id)}
                            className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-semibold text-zinc-600 transition hover:bg-white dark:bg-zinc-950/50 dark:text-zinc-300"
                        >
                            Jump in draft
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
