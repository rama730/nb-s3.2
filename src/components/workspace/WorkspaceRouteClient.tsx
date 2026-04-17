"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const WORKSPACE_TABS = [
    {
        id: "overview",
        label: "Overview",
        title: "Workspace overview",
        description: "Jump into the core workspace areas from one stable landing surface.",
    },
    {
        id: "tasks",
        label: "Tasks",
        title: "Task focus",
        description: "Review active work, blockers, and next actions without leaving the workspace shell.",
    },
    {
        id: "inbox",
        label: "Inbox",
        title: "Inbox triage",
        description: "Keep notifications, mentions, and collaboration handoffs in one place.",
    },
    {
        id: "projects",
        label: "Projects",
        title: "Project pulse",
        description: "Move quickly between the projects that need attention today.",
    },
    {
        id: "notes",
        label: "Notes",
        title: "Notes and drafts",
        description: "Capture lightweight context while the full workspace refresh continues.",
    },
    {
        id: "activity",
        label: "Activity",
        title: "Recent activity",
        description: "See the latest updates across your workspace without document-level scrolling.",
    },
];

type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]["id"];

export default function WorkspaceRouteClient() {
    const [activeTab, setActiveTab] = useState<WorkspaceTabId>("overview");

    return (
        <div
            className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950"
        >
            <div
                className="mx-auto flex h-full min-h-0 max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8"
            >
                <section className="rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90">
                    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                                Workspace
                            </span>
                            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                                Workspace shell
                            </h1>
                            <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                                This compatibility shell keeps the workspace route stable while the larger panel refresh continues.
                            </p>
                        </div>
                        <div className="grid min-w-[220px] grid-cols-2 gap-3 text-sm">
                            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Today</div>
                                <div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">6</div>
                                <div className="text-zinc-500 dark:text-zinc-400">active areas</div>
                            </div>
                            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Status</div>
                                <div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Stable</div>
                                <div className="text-zinc-500 dark:text-zinc-400">route contract</div>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <div
                            className="inline-flex min-w-full gap-2 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-2 dark:border-zinc-800 dark:bg-zinc-950/70"
                            role="tablist"
                            aria-label="Workspace sections"
                        >
                            {WORKSPACE_TABS.map((tab) => {
                                const isActive = tab.id === activeTab;
                                return (
                                    <button
                                        key={tab.id}
                                        id={`workspace-tab-${tab.id}`}
                                        type="button"
                                        role="tab"
                                        aria-controls={`workspace-panel-${tab.id}`}
                                        aria-selected={isActive}
                                        data-testid={`workspace-tab-${tab.id}`}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={cn(
                                            "rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                                            isActive
                                                ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                                                : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="mt-6">
                        {WORKSPACE_TABS.map((tab) => {
                            const isActive = tab.id === activeTab;
                            return (
                                <section
                                    key={tab.id}
                                    id={`workspace-panel-${tab.id}`}
                                    aria-labelledby={`workspace-tab-${tab.id}`}
                                    hidden={!isActive}
                                    className={cn(!isActive && "hidden")}
                                >
                                    <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-6 dark:border-zinc-800 dark:bg-zinc-950/60">
                                        <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                                            {tab.title}
                                        </h2>
                                        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                                            {tab.description}
                                        </p>
                                        <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Primary</div>
                                                <div className="mt-3 text-base font-medium text-zinc-950 dark:text-zinc-50">
                                                    {tab.label} stays available as a stable workspace entry point.
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Behavior</div>
                                                <div className="mt-3 text-base font-medium text-zinc-950 dark:text-zinc-50">
                                                    Tabs switch locally and reset cleanly to Overview after reload.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </section>
            </div>
        </div>
    );
}
