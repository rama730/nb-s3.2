"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";

import {
    PROJECT_README_INSERT_ACTIONS,
    type ProjectReadmeMorePanel,
} from "@/components/projects/readme/ProjectReadmeMoreMenu";
import { cn } from "@/lib/utils";

function actionMatches(action: (typeof PROJECT_README_INSERT_ACTIONS)[number], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return [
        action.id,
        action.label,
        action.description,
        action.category,
        ...action.aliases,
    ].some((value) => value.toLowerCase().includes(normalized));
}

const RECENT_INSERT_KEY = "project-readme-recent-insert-tools";

const INSERT_CATEGORY_LABELS: Record<(typeof PROJECT_README_INSERT_ACTIONS)[number]["category"], string> = {
    write: "Write",
    structure: "Structure",
    project: "Project",
    media: "Media",
    review: "Review",
    history: "History",
};

export function ProjectReadmeInsertCommandCenter({
    open,
    activePanel,
    panelTitle,
    panelDescription,
    onPanelChange,
    onClose,
    projectName,
    children,
}: {
    open: boolean;
    activePanel: ProjectReadmeMorePanel | null;
    panelTitle: string;
    panelDescription: string;
    onPanelChange: (panel: ProjectReadmeMorePanel) => void;
    onClose: () => void;
    projectName?: string | null;
    children: ReactNode;
}) {
    const [search, setSearch] = useState("");
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [recentPanels, setRecentPanels] = useState<ProjectReadmeMorePanel[]>([]);
    const visibleActions = useMemo(
        () => PROJECT_README_INSERT_ACTIONS.filter((action) => actionMatches(action, search)),
        [search],
    );
    const recentActions = useMemo(() => (
        recentPanels
            .map((panel) => PROJECT_README_INSERT_ACTIONS.find((action) => action.id === panel))
            .filter((action): action is (typeof PROJECT_README_INSERT_ACTIONS)[number] => Boolean(action))
            .filter((action) => visibleActions.some((visible) => visible.id === action.id))
    ), [recentPanels, visibleActions]);
    const groupedActions = useMemo(() => (
        [
            ...(recentActions.length ? [{
                category: "recent",
                label: "Recent",
                actions: recentActions,
            }] : []),
            ...Object.entries(INSERT_CATEGORY_LABELS)
            .map(([category, label]) => ({
                category,
                label,
                actions: visibleActions.filter((action) => action.category === category),
            }))
            .filter((group) => group.actions.length > 0),
        ]
    ), [recentActions, visibleActions]);
    const flatActions = useMemo(() => groupedActions.flatMap((group) => group.actions), [groupedActions]);

    useEffect(() => {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(RECENT_INSERT_KEY) || "[]");
            if (Array.isArray(parsed)) {
                setRecentPanels(parsed.filter((value): value is ProjectReadmeMorePanel => PROJECT_README_INSERT_ACTIONS.some((action) => action.id === value)).slice(0, 4));
            }
        } catch {
            setRecentPanels([]);
        }
    }, []);

    useEffect(() => {
        if (!open || !activePanel) return;
        setRecentPanels((current) => {
            const next = [activePanel, ...current.filter((panel) => panel !== activePanel)].slice(0, 4);
            try {
                window.localStorage.setItem(RECENT_INSERT_KEY, JSON.stringify(next));
            } catch {
                // Recent tools are a convenience only.
            }
            return next;
        });
    }, [activePanel, open]);

    useEffect(() => {
        setFocusedIndex(0);
    }, [search]);

    useEffect(() => {
        if (!open) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setFocusedIndex((current) => {
                    const max = Math.max(0, flatActions.length - 1);
                    if (event.key === "ArrowDown") return current >= max ? 0 : current + 1;
                    return current <= 0 ? max : current - 1;
                });
                return;
            }
            if (event.key === "Enter" && flatActions[focusedIndex]) {
                event.preventDefault();
                onPanelChange(flatActions[focusedIndex].id);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [flatActions, focusedIndex, onClose, onPanelChange, open]);

    return (
        <div
            className={cn(
                "fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-black/60 p-3 backdrop-blur-sm sm:p-5",
                !open && "hidden"
            )}
            role="dialog"
            aria-modal="true"
            aria-label="Insert into README"
            data-readme-insert-command-center="true"
            data-readme-insert-tools-grouped="true"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="flex h-[min(900px,calc(100dvh-1.5rem))] w-[min(118rem,calc(100vw-1.5rem))] min-w-0 overflow-hidden rounded-[1.25rem] border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:h-[min(900px,calc(100dvh-2.5rem))] sm:w-[min(118rem,calc(100vw-2.5rem))]">
                <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
                    <aside className="app-scroll app-scroll-y app-scroll-gutter flex min-h-0 flex-col overscroll-contain border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/20">
                        <header className="flex shrink-0 items-start justify-between gap-4 p-5 pb-0 lg:p-6 lg:pb-0">
                            <div className="min-w-0">
                                <p className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Insert into README</p>
                                <p className="mt-1 truncate text-sm text-zinc-500">
                                    {projectName ? `${projectName} workspace` : "Documentation workspace"}
                                </p>
                            </div>
                        </header>
                        <div className="flex-1 p-5 lg:p-6">
                            <label className="mb-6 flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-blue-500 dark:bg-zinc-950 dark:ring-zinc-800">
                            <Search className="h-4 w-4 text-zinc-400" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search insert tools..."
                                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
                            />
                        </label>
                        <nav className="space-y-6 pr-1" aria-label="README insert tools">
                            {groupedActions.map((group) => (
                                <div key={group.category} className="space-y-1">
                                    <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
                                        {group.label}
                                    </p>
                                    <div className="space-y-0.5">
                                        {group.actions.map((action) => {
                                            const Icon = action.icon;
                                            const selected = action.id === activePanel;
                                            const isFocused = flatActions[focusedIndex]?.id === action.id;
                                            return (
                                                <button
                                                    key={action.id}
                                                    type="button"
                                                    onClick={() => onPanelChange(action.id)}
                                                    className={cn(
                                                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                                                        selected
                                                            ? "bg-blue-100/50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                                                            : isFocused
                                                                ? "bg-zinc-200/50 text-zinc-900 dark:bg-zinc-800/50 dark:text-zinc-100"
                                                                : "text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200",
                                                    )}
                                                >
                                                    <span className={cn(
                                                        "flex shrink-0 items-center justify-center rounded-lg p-1.5",
                                                        selected
                                                            ? "bg-blue-600 text-white dark:bg-blue-500"
                                                            : "bg-white text-zinc-500 shadow-sm ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800",
                                                    )}>
                                                        <Icon className="h-4 w-4" />
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block text-sm font-medium">{action.label}</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            {!visibleActions.length ? (
                                <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-5 text-sm text-zinc-500 dark:border-zinc-800">
                                    No insert tool matches that search.
                                </p>
                            ) : null}
                        </nav>
                        </div>
                    </aside>

                    <main className="app-scroll app-scroll-y app-scroll-gutter relative min-h-0 overscroll-contain bg-white p-6 dark:bg-zinc-950 sm:p-8 lg:p-12 lg:pt-14">
                        <button
                            type="button"
                            onClick={onClose}
                            className="absolute right-5 top-5 z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                            aria-label="Close insert workspace"
                        >
                            <X className="h-4 w-4" />
                        </button>
                        <div className="mb-10">
                            <p className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{panelTitle}</p>
                            <p className="mt-2.5 text-base leading-6 text-zinc-500 dark:text-zinc-400">{panelDescription}</p>
                        </div>
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
}
