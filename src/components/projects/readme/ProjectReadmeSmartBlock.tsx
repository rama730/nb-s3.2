"use client";

import Link from "next/link";
import { AlertCircle, FileText, FolderOpen, ListTodo, Sparkles, Timer, Users } from "lucide-react";

import { ProjectReadmeSmartBlockPreviewCard } from "@/components/projects/readme/ProjectReadmeReferencePreview";
import type { ProjectReadmeSmartBlock, ProjectReadmeSmartBlockPreview } from "@/lib/projects/readme-blocks";
import type { Project } from "@/types/hub";
import { cn } from "@/lib/utils";

const BLOCK_COPY: Record<ProjectReadmeSmartBlock["kind"], { title: string; icon: typeof Sparkles; tab: string; description: string }> = {
    roles: {
        title: "Open roles",
        icon: Users,
        tab: "settings",
        description: "Role needs and application context from the project.",
    },
    contributors: {
        title: "Contributors",
        icon: Users,
        tab: "dashboard",
        description: "Active project contributors and collaborators.",
    },
    files: {
        title: "Referenced files",
        icon: FolderOpen,
        tab: "files",
        description: "Managed files that are safe for this viewer.",
    },
    tasks: {
        title: "Referenced tasks",
        icon: ListTodo,
        tab: "tasks",
        description: "Project work items linked from the README.",
    },
    sprints: {
        title: "Sprint story",
        icon: Timer,
        tab: "sprints",
        description: "Planning rhythm and sprint movement.",
    },
    unknown: {
        title: "Unknown README block",
        icon: AlertCircle,
        tab: "readme",
        description: "This block is not recognized and is hidden from public readers.",
    },
};

export function ProjectReadmeSmartBlock({
    block,
    project,
    editorMode = false,
    preview,
    loading = false,
}: {
    block: ProjectReadmeSmartBlock;
    project: Project;
    editorMode?: boolean;
    preview?: ProjectReadmeSmartBlockPreview | null;
    loading?: boolean;
}) {
    if (block.kind === "unknown" && !editorMode) return null;
    if (preview) return <ProjectReadmeSmartBlockPreviewCard preview={preview} />;
    if (loading && block.kind !== "unknown") {
        return (
            <div className="my-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-3 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-3 w-64 max-w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                    </div>
                </div>
            </div>
        );
    }

    const copy = BLOCK_COPY[block.kind];
    const Icon = copy.icon;
    const slugOrId = project.slug || project.id;
    const href = `/projects/${encodeURIComponent(slugOrId)}?tab=${copy.tab}`;
    const roles = Array.isArray((project as any).openRoles) ? (project as any).openRoles : [];
    const collaborators = Array.isArray((project as any).collaborators) ? (project as any).collaborators : [];

    const summary =
        block.kind === "roles"
            ? `${roles.length} role${roles.length === 1 ? "" : "s"} listed`
            : block.kind === "contributors"
                ? `${collaborators.length} collaborator${collaborators.length === 1 ? "" : "s"} visible`
                : block.kind === "files" || block.kind === "tasks"
                ? block.ids.length > 0 ? `${block.ids.length} specific item${block.ids.length === 1 ? "" : "s"} linked` : "Open the project surface for current items"
                    : block.kind === "sprints"
                        ? "Open sprint rhythm"
                        : "Editor attention needed";

    return (
        <div
            className={cn(
                "my-4 rounded-2xl border p-4",
                block.kind === "unknown"
                    ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100"
                    : "border-blue-200 bg-blue-50/70 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/20 dark:text-blue-100",
            )}
        >
            <div className="flex items-start gap-3">
                <span className="rounded-xl bg-white/70 p-2 shadow-sm dark:bg-white/10">
                    <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-semibold">{copy.title}</p>
                    <p className="mt-1 text-sm opacity-80">{copy.description}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{summary}</p>
                </div>
                {block.kind !== "unknown" ? (
                    <Link
                        href={href}
                        className="rounded-full border border-current/20 px-3 py-1 text-xs font-semibold transition hover:bg-white/50 dark:hover:bg-white/10"
                    >
                        Open
                    </Link>
                ) : (
                    <FileText className="h-4 w-4 opacity-70" />
                )}
            </div>
        </div>
    );
}
