"use client";

import {
    AlertTriangle,
    ChevronDown,
    Code2,
    FileClock,
    ImagePlus,
    Library,
    Link2,
    Palette,
    Plus,
    ShieldAlert,
    Table2,
    type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ProjectDocMorePanel = "style" | "table" | "command" | "callout" | "link" | "reference" | "assets" | "quality" | "history";

type InsertCategory = "write" | "structure" | "project" | "media" | "review" | "history";

export type ProjectDocInsertAction = {
    id: ProjectDocMorePanel;
    label: string;
    description: string;
    category: InsertCategory;
    aliases: string[];
    icon: LucideIcon;
};

export const PROJECT_DOC_INSERT_ACTIONS: ProjectDocInsertAction[] = [
    {
        id: "style",
        label: "Style",
        description: "Choose a document structure for open-source, product, technical, internal, or portfolio pages.",
        category: "write",
        aliases: ["style", "template", "preset", "layout", "readme", "open source", "technical", "portfolio", "product"],
        icon: Palette,
    },
    {
        id: "reference",
        label: "Project mention",
        description: "Mention a task, sprint, file, role, or collaborator inline.",
        category: "project",
        aliases: ["task", "tasks", "sprint", "sprints", "file", "files", "role", "roles", "member", "members", "contributor"],
        icon: Library,
    },
    {
        id: "table",
        label: "Table",
        description: "Build comparisons, metrics, roadmaps, or simple status tables.",
        category: "structure",
        aliases: ["table", "grid", "compare", "comparison", "before", "after", "percent", "percentage", "metrics"],
        icon: Table2,
    },
    {
        id: "command",
        label: "Command",
        description: "Add a GitHub-style copyable install or run command.",
        category: "structure",
        aliases: ["command", "code", "bash", "shell", "terminal", "install", "run", "npm", "pnpm", "yarn"],
        icon: Code2,
    },
    {
        id: "callout",
        label: "Callout",
        description: "Add a note, tip, important, warning, or caution block.",
        category: "write",
        aliases: ["note", "tip", "important", "warning", "caution", "callout"],
        icon: AlertTriangle,
    },
    {
        id: "link",
        label: "Link",
        description: "Create a clean Markdown link for docs, demos, or support.",
        category: "write",
        aliases: ["link", "url", "docs", "demo", "website", "support"],
        icon: Link2,
    },
    {
        id: "assets",
        label: "Image",
        description: "Upload managed document media with alt text.",
        category: "media",
        aliases: ["image", "photo", "screenshot", "gif", "demo", "media", "asset", "upload"],
        icon: ImagePlus,
    },
    {
        id: "quality",
        label: "Quality",
        description: "Review missing sections, unsafe links, media issues, and publish blockers.",
        category: "review",
        aliases: ["quality", "review", "audit", "score", "blocker", "warning", "readiness"],
        icon: ShieldAlert,
    },

    {
        id: "history",
        label: "History",
        description: "Restore, publish, delete versions, or discard draft changes.",
        category: "history",
        aliases: ["history", "version", "versions", "restore", "draft"],
        icon: FileClock,
    },
];

function getAction(panel: ProjectDocMorePanel) {
    return PROJECT_DOC_INSERT_ACTIONS.find((action) => action.id === panel) ?? null;
}

export function getProjectDocInsertAction(panel: ProjectDocMorePanel) {
    return getAction(panel);
}

export function ProjectDocMoreMenu({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenPanel: (panel: ProjectDocMorePanel) => void;
}) {
    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => onOpenChange(!open)}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                title="Open document tools"
            >
                <Plus className="h-4 w-4" />
                Insert
                <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
            </button>
        </div>
    );
}
