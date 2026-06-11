"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Check, FileText, FolderOpen, ListTodo, Search, Timer, Users } from "lucide-react";

import { ProjectReadmeReferenceOptionCard } from "@/components/projects/readme/ProjectReadmeReferencePreview";
import { useProjectReadmeReferenceOptions } from "@/hooks/hub/useProjectReadmeData";
import {
    buildInlineReadmeReference,
    normalizeReadmeReferenceLabel,
    type ProjectReadmeReferenceKind,
    type ProjectReadmeReferenceOption,
} from "@/lib/projects/readme-blocks";
import { cn } from "@/lib/utils";

const REFERENCE_KINDS: Array<{
    id: ProjectReadmeReferenceKind;
    label: string;
    description: string;
    icon: typeof FileText;
}> = [
    { id: "tasks", label: "Tasks", description: "Link exact work items.", icon: ListTodo },
    { id: "sprints", label: "Sprints", description: "Show sprint context.", icon: Timer },
    { id: "files", label: "Files", description: "Reference project assets.", icon: FolderOpen },
    { id: "roles", label: "Roles", description: "Show open needs.", icon: Users },
    { id: "contributors", label: "Contributors", description: "Feature collaborators.", icon: Users },
];
const ALL_REFERENCE_KIND = {
    id: "all" as const,
    label: "All",
    description: "Search every project record.",
    icon: Search,
};
type ReferencePickerKind = ProjectReadmeReferenceKind | typeof ALL_REFERENCE_KIND.id;

function buildSmartBlock(kind: ProjectReadmeReferenceKind, selected: ProjectReadmeReferenceOption[]) {
    const ids = selected.map((option) => option.id).join(",");
    return `{% project.${kind}${ids ? ` ids="${ids}"` : ""} %}`;
}

function referenceKey(option: Pick<ProjectReadmeReferenceOption, "kind" | "id">) {
    return `${option.kind}:${option.id}`;
}

function buildSmartBlocksFromSelection(selected: ProjectReadmeReferenceOption[]) {
    const groups = new Map<ProjectReadmeReferenceKind, ProjectReadmeReferenceOption[]>();
    selected.forEach((option) => {
        const items = groups.get(option.kind) ?? [];
        items.push(option);
        groups.set(option.kind, items);
    });
    return Array.from(groups.entries())
        .map(([groupKind, items]) => buildSmartBlock(groupKind, items))
        .join("\n");
}

export function ProjectReadmeReferencePicker({
    projectId,
    initialKind,
    onInsert,
    onClose,
}: {
    projectId: string;
    initialKind?: ProjectReadmeReferenceKind;
    onInsert: (markdown: string) => void;
    onClose?: () => void;
}) {
    const [kind, setKind] = useState<ReferencePickerKind>(initialKind ?? "all");
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [selected, setSelected] = useState<ProjectReadmeReferenceOption[]>([]);
    const canSearchAll = kind === "all" && deferredQuery.trim().length >= 2;
    const taskOptionsQuery = useProjectReadmeReferenceOptions(projectId, "tasks", deferredQuery, Boolean(projectId) && (canSearchAll || kind === "tasks"));
    const sprintOptionsQuery = useProjectReadmeReferenceOptions(projectId, "sprints", deferredQuery, Boolean(projectId) && (canSearchAll || kind === "sprints"));
    const fileOptionsQuery = useProjectReadmeReferenceOptions(projectId, "files", deferredQuery, Boolean(projectId) && (canSearchAll || kind === "files"));
    const roleOptionsQuery = useProjectReadmeReferenceOptions(projectId, "roles", deferredQuery, Boolean(projectId) && (canSearchAll || kind === "roles"));
    const contributorOptionsQuery = useProjectReadmeReferenceOptions(projectId, "contributors", deferredQuery, Boolean(projectId) && (canSearchAll || kind === "contributors"));
    const queryByKind = {
        tasks: taskOptionsQuery,
        sprints: sprintOptionsQuery,
        files: fileOptionsQuery,
        roles: roleOptionsQuery,
        contributors: contributorOptionsQuery,
    };
    const optionsQuery = kind === "all" ? null : queryByKind[kind];
    const allOptions = useMemo(() => (
        [
            ...(taskOptionsQuery.data ?? []),
            ...(sprintOptionsQuery.data ?? []),
            ...(fileOptionsQuery.data ?? []),
            ...(roleOptionsQuery.data ?? []),
            ...(contributorOptionsQuery.data ?? []),
        ]
    ), [contributorOptionsQuery.data, fileOptionsQuery.data, roleOptionsQuery.data, sprintOptionsQuery.data, taskOptionsQuery.data]);
    const visibleOptions = kind === "all" ? (canSearchAll ? allOptions : []) : optionsQuery?.data ?? [];
    const loading = kind === "all" && canSearchAll
        ? taskOptionsQuery.isLoading || sprintOptionsQuery.isLoading || fileOptionsQuery.isLoading || roleOptionsQuery.isLoading || contributorOptionsQuery.isLoading
        : Boolean(optionsQuery?.isLoading);
    const hasError = kind === "all" && canSearchAll
        ? taskOptionsQuery.isError || sprintOptionsQuery.isError || fileOptionsQuery.isError || roleOptionsQuery.isError || contributorOptionsQuery.isError
        : Boolean(optionsQuery?.error);

    const selectedIds = useMemo(() => new Set(selected.map(referenceKey)), [selected]);
    const activeKind = kind === "all" ? ALL_REFERENCE_KIND : (REFERENCE_KINDS.find((item) => item.id === kind) ?? REFERENCE_KINDS[0]!);
    const ActiveIcon = activeKind.icon;
    const selectedByKind = useMemo(() => {
        const groups = new Map<ProjectReadmeReferenceKind, ProjectReadmeReferenceOption[]>();
        selected.forEach((option) => {
            const list = groups.get(option.kind) ?? [];
            list.push(option);
            groups.set(option.kind, list);
        });
        return Array.from(groups.entries());
    }, [selected]);

    const toggleOption = (option: ProjectReadmeReferenceOption) => {
        setSelected((current) => {
            const key = referenceKey(option);
            const exists = current.some((item) => referenceKey(item) === key);
            if (exists) return current.filter((item) => referenceKey(item) !== key);
            return [...current, option];
        });
    };

    const changeKind = (nextKind: ReferencePickerKind) => {
        setKind(nextKind);
        setQuery("");
    };

    const insertMention = () => {
        const markdown = selected.map((option) => buildInlineReadmeReference(option)).join(" ");
        onInsert(markdown);
        setSelected([]);
        onClose?.();
    };

    const insertFullBlock = () => {
        onInsert(`\n${buildSmartBlocksFromSelection(selected)}\n`);
        setSelected([]);
        onClose?.();
    };

    return (
        <div className="space-y-8">
            <div>
                <p className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Insert project mention</p>
                <p className="mt-1.5 text-sm leading-6 text-zinc-500">
                    Pick real project records. README stores stable IDs, but readers see compact names and context.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {[ALL_REFERENCE_KIND, ...REFERENCE_KINDS].map((item) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => changeKind(item.id)}
                            className={cn(
                                "rounded-xl border px-3 py-2 text-left transition",
                                kind === item.id
                                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
                                    : "border-zinc-200 text-zinc-600 hover:border-blue-300 dark:border-zinc-800 dark:text-zinc-300",
                            )}
                        >
                            <span className="flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5" />
                                <span className="block text-xs font-semibold">{item.label}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 dark:border-zinc-800">
                <Search className="h-5 w-5 text-zinc-400" />
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${activeKind.label.toLowerCase()}...`}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
                />
            </label>

            <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                            <ActiveIcon className="h-4 w-4" />
                        </span>
                        <div>
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{activeKind.label}</p>
                            <p className="text-xs text-zinc-500">{activeKind.description}</p>
                        </div>
                    </div>
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-500 dark:bg-zinc-900">
                        {selected.length} selected
                    </span>
                </div>

                {loading ? (
                    <div className="grid gap-2">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                        ))}
                    </div>
                ) : hasError ? (
                    <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-300">
                        Failed to load references. Try another search.
                    </p>
                ) : kind === "all" && !canSearchAll ? (
                    <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
                        Type at least 2 characters to search every project record.
                    </p>
                ) : visibleOptions.length ? (
                    <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                        {visibleOptions.map((option) => (
                            <ProjectReadmeReferenceOptionCard
                                key={referenceKey(option)}
                                option={option}
                                selected={selectedIds.has(referenceKey(option))}
                                onSelect={() => toggleOption(option)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
                        No matching {activeKind.label.toLowerCase()} found.
                    </p>
                )}
            </div>

            {selected.length ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/70 dark:bg-blue-950/20">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-300">Selected mentions</p>
                    <div className="mb-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-950/50 dark:text-zinc-300">
                        Inline preview:{" "}
                        {selected.slice(0, 4).map((option, index) => (
                            <span key={`inline-preview-${option.kind}-${option.id}`}>
                                {index > 0 ? " · " : null}
                                <span className="font-semibold text-blue-600 dark:text-blue-300">
                                    {normalizeReadmeReferenceLabel(option.kind, option.title)}
                                </span>
                            </span>
                        ))}
                        {selected.length > 4 ? ` · +${selected.length - 4} more` : null}
                    </div>
                    <div className="mb-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-950/50 dark:text-zinc-300">
                        Full block preview:
                        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] [overflow-wrap:anywhere]">{buildSmartBlocksFromSelection(selected)}</pre>
                    </div>
                    {selectedByKind.length > 1 ? (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                            {selectedByKind.map(([groupKind, items]) => (
                                <span key={groupKind} className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                                    {items.length} {groupKind}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        {selected.slice(0, 6).map((option) => (
                            <ProjectReadmeReferenceOptionCard key={`selected-${option.kind}-${option.id}`} option={option} selected />
                        ))}
                    </div>
                    {selected.length > 4 ? (
                        <p className="mt-2 text-xs text-blue-700 dark:text-blue-200">+{selected.length - 4} more selected</p>
                    ) : null}
                </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
                <button
                    type="button"
                    onClick={insertFullBlock}
                    disabled={!selected.length}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                >
                    Insert full block
                </button>
                <button
                    type="button"
                    onClick={insertMention}
                    disabled={!selected.length}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Check className="h-4 w-4" />
                    Insert mention
                </button>
            </div>
        </div>
    );
}
