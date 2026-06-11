"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Eye, Plus, Table2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

type TableAlignment = "left" | "center" | "right";

type TableBuilderPhase = "choose" | "edit" | "preview";

type TablePresetId = "before_after" | "metrics" | "roadmap" | "team" | "sprint" | "files" | "custom";

type TableDraft = {
    columns: string[];
    alignments: TableAlignment[];
    rows: string[][];
};

const TABLE_PRESETS: Array<{
    id: TablePresetId;
    label: string;
    description: string;
    draft: TableDraft;
}> = [
    {
        id: "before_after",
        label: "Before / After",
        description: "Compare two workflows or outcomes.",
        draft: {
            columns: ["Before", "After"],
            alignments: ["left", "left"],
            rows: [
                ["Current flow", "Improved flow"],
                ["Manual setup", "One command"],
            ],
        },
    },
    {
        id: "metrics",
        label: "Metrics",
        description: "Show percentages, counts, or results.",
        draft: {
            columns: ["Metric", "Value"],
            alignments: ["left", "right"],
            rows: [
                ["Completion", "75%"],
                ["Accuracy", "100%"],
                ["Speed increase", "~3x"],
            ],
        },
    },
    {
        id: "roadmap",
        label: "Roadmap",
        description: "Explain what has shipped and what comes next.",
        draft: {
            columns: ["Stage", "Status", "Next step"],
            alignments: ["left", "center", "left"],
            rows: [
                ["Foundation", "Done", "Improve onboarding"],
                ["Launch", "In progress", "Collect feedback"],
            ],
        },
    },
    {
        id: "team",
        label: "Team responsibilities",
        description: "Map contributors to ownership areas.",
        draft: {
            columns: ["Contributor", "Responsibility", "Status"],
            alignments: ["left", "left", "center"],
            rows: [
                ["Ramanayudu CH", "Product direction", "Active"],
                ["Contributor", "Implementation", "Active"],
            ],
        },
    },
    {
        id: "sprint",
        label: "Sprint summary",
        description: "Summarize sprint focus and result.",
        draft: {
            columns: ["Sprint", "Focus", "Result"],
            alignments: ["left", "left", "left"],
            rows: [
                ["Sprint 1", "Core workflow", "Completed"],
                ["Sprint 2", "README polish", "In progress"],
            ],
        },
    },
    {
        id: "files",
        label: "File summary",
        description: "Document important files or assets.",
        draft: {
            columns: ["File", "Purpose", "Status"],
            alignments: ["left", "left", "center"],
            rows: [
                ["README.md", "Project documentation", "Ready"],
                ["demo.png", "Product preview", "Draft"],
            ],
        },
    },
    {
        id: "custom",
        label: "Blank table",
        description: "Start with a simple editable table.",
        draft: {
            columns: ["Column 1", "Column 2"],
            alignments: ["left", "left"],
            rows: [["", ""]],
        },
    },
];

function cloneDraft(draft: TableDraft): TableDraft {
    return {
        columns: [...draft.columns],
        alignments: [...draft.alignments],
        rows: draft.rows.map((row) => [...row]),
    };
}

function escapeMarkdownTableCell(value: string) {
    return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function alignmentMarkdown(alignment: TableAlignment) {
    if (alignment === "center") return ":---:";
    if (alignment === "right") return "---:";
    return ":---";
}

function buildMarkdownTable(draft: TableDraft) {
    const columns = draft.columns.map((column, index) => escapeMarkdownTableCell(column || `Column ${index + 1}`));
    const alignments = draft.alignments.map(alignmentMarkdown);
    const rows = draft.rows.length ? draft.rows : [draft.columns.map(() => "")];
    return [
        `| ${columns.join(" | ")} |`,
        `| ${alignments.join(" | ")} |`,
        ...rows.map((row) => `| ${draft.columns.map((_, index) => escapeMarkdownTableCell(row[index] ?? "")).join(" | ")} |`),
    ].join("\n");
}

export function ProjectReadmeTableBuilder({
    onInsert,
    onClose,
}: {
    onInsert: (markdown: string) => void;
    onClose?: () => void;
}) {
    const [presetId, setPresetId] = useState<TablePresetId>("before_after");
    const [draft, setDraft] = useState<TableDraft>(() => cloneDraft(TABLE_PRESETS[0]!.draft));
    const [phase, setPhase] = useState<TableBuilderPhase>("choose");
    const preview = useMemo(() => buildMarkdownTable(draft), [draft]);
    const activePreset = TABLE_PRESETS.find((item) => item.id === presetId) ?? TABLE_PRESETS[0]!;

    const applyPreset = (nextPresetId: TablePresetId) => {
        const preset = TABLE_PRESETS.find((item) => item.id === nextPresetId) ?? TABLE_PRESETS[0]!;
        setPresetId(nextPresetId);
        setDraft(cloneDraft(preset.draft));
        setPhase("edit");
    };

    const updateColumn = (index: number, value: string) => {
        setDraft((current) => ({
            ...current,
            columns: current.columns.map((column, columnIndex) => columnIndex === index ? value : column),
        }));
    };

    const updateAlignment = (index: number, value: TableAlignment) => {
        setDraft((current) => ({
            ...current,
            alignments: current.alignments.map((alignment, alignmentIndex) => alignmentIndex === index ? value : alignment),
        }));
    };

    const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
        setDraft((current) => ({
            ...current,
            rows: current.rows.map((row, currentRowIndex) => (
                currentRowIndex === rowIndex
                    ? current.columns.map((_, currentColumnIndex) => currentColumnIndex === columnIndex ? value : row[currentColumnIndex] ?? "")
                    : row
            )),
        }));
    };

    const addColumn = () => {
        setDraft((current) => ({
            columns: [...current.columns, `Column ${current.columns.length + 1}`],
            alignments: [...current.alignments, "left"],
            rows: current.rows.map((row) => [...row, ""]),
        }));
    };

    const removeColumn = (index: number) => {
        setDraft((current) => {
            if (current.columns.length <= 1) return current;
            return {
                columns: current.columns.filter((_, columnIndex) => columnIndex !== index),
                alignments: current.alignments.filter((_, alignmentIndex) => alignmentIndex !== index),
                rows: current.rows.map((row) => row.filter((_, columnIndex) => columnIndex !== index)),
            };
        });
    };

    const addRow = () => {
        setDraft((current) => ({
            ...current,
            rows: [...current.rows, current.columns.map(() => "")],
        }));
    };

    const removeRow = (index: number) => {
        setDraft((current) => ({
            ...current,
            rows: current.rows.length <= 1 ? current.rows : current.rows.filter((_, rowIndex) => rowIndex !== index),
        }));
    };

    const handleInsert = () => {
        onInsert(`\n${preview}\n`);
        onClose?.();
    };

    return (
        <div className="flex min-h-full flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
                {[
                    { id: "choose", label: "Choose" },
                    { id: "edit", label: "Build" },
                    { id: "preview", label: "Preview" },
                ].map((step, index) => (
                    <div key={step.id} className="flex items-center gap-2">
                        <span
                            className={cn(
                                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
                                phase === step.id
                                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
                                    : "border-zinc-200 text-zinc-500 dark:border-zinc-800",
                            )}
                        >
                            {index + 1}. {step.label}
                        </span>
                        {index < 2 ? <ChevronRight className="h-3.5 w-3.5 text-zinc-400" /> : null}
                    </div>
                ))}
            </div>

            {phase === "choose" ? (
                <div className="space-y-4">
                    <div>
                        <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Choose a table type</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">
                            Start with a structure that matches the README section you are writing.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {TABLE_PRESETS.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                onClick={() => applyPreset(preset.id)}
                                className="rounded-2xl border border-zinc-200 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                            >
                                <span className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                    <Table2 className="h-4 w-4 text-blue-500" />
                                    {preset.label}
                                </span>
                                <span className="mt-2 block text-xs leading-5 text-zinc-500">{preset.description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {phase === "edit" ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{activePreset.label}</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{activePreset.description}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setPhase("choose")}
                            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Change type
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-zinc-200 shadow-sm dark:border-zinc-800">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-zinc-50 dark:bg-zinc-900/50">
                                    {draft.columns.map((column, columnIndex) => (
                                        <th key={columnIndex} className="min-w-[240px] border-b border-r border-zinc-200 p-0 text-left align-top last:border-r-0 dark:border-zinc-800">
                                            <div className="flex flex-col">
                                                <div className="flex items-center justify-between gap-2 border-b border-zinc-200/50 p-2 dark:border-zinc-800/50">
                                                    <input
                                                        value={column}
                                                        onChange={(event) => updateColumn(columnIndex, event.target.value)}
                                                        className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 text-sm font-semibold outline-none focus:bg-white dark:focus:bg-zinc-900"
                                                        placeholder={`Column ${columnIndex + 1}`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeColumn(columnIndex)}
                                                        className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20"
                                                        aria-label="Remove column"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                                <div className="px-2 py-1.5">
                                                    <select
                                                        value={draft.alignments[columnIndex] ?? "left"}
                                                        onChange={(event) => updateAlignment(columnIndex, event.target.value as TableAlignment)}
                                                        className="w-full bg-transparent px-1 text-xs font-semibold text-zinc-500 outline-none"
                                                    >
                                                        <option value="left">Left aligned</option>
                                                        <option value="center">Centered</option>
                                                        <option value="right">Right aligned</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </th>
                                    ))}
                                    <th className="border-b border-zinc-200 bg-white p-3 text-left align-top dark:border-zinc-800 dark:bg-zinc-950">
                                        <button
                                            type="button"
                                            onClick={addColumn}
                                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Add Column
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {draft.rows.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="group transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20">
                                        {draft.columns.map((_, columnIndex) => (
                                            <td key={columnIndex} className="min-w-[240px] border-b border-r border-zinc-200 p-0 last:border-r-0 group-last:border-b-0 dark:border-zinc-800">
                                                <input
                                                    value={row[columnIndex] ?? ""}
                                                    onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                                                    className="w-full bg-transparent px-4 py-3 text-sm outline-none focus:bg-blue-50/30 dark:focus:bg-blue-900/10"
                                                    placeholder="Cell value"
                                                />
                                            </td>
                                        ))}
                                        <td className="border-b border-zinc-200 p-2 group-last:border-b-0 dark:border-zinc-800">
                                            <button
                                                type="button"
                                                onClick={() => removeRow(rowIndex)}
                                                className="shrink-0 rounded-md p-1.5 text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/20"
                                                aria-label="Remove row"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <button
                        type="button"
                        onClick={addRow}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 py-2.5 text-sm font-semibold text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
                    >
                        <Plus className="h-4 w-4" />
                        Add Row
                    </button>

                    <div className="sticky bottom-0 z-10 -mx-1 flex justify-end border-t border-zinc-200 bg-white/95 px-1 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                        <button
                            type="button"
                            onClick={() => setPhase("preview")}
                            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                        >
                            <Eye className="h-4 w-4" />
                            Preview table
                        </button>
                    </div>
                </div>
            ) : null}

            {phase === "preview" ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Review Markdown</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">
                                This is the exact Markdown that will be inserted into the README.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setPhase("edit")}
                            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Edit table
                        </button>
                    </div>

                    <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900/60">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Markdown preview</p>
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-6 text-zinc-700 dark:text-zinc-300">{preview}</pre>
                    </div>

                    <div className="sticky bottom-0 z-10 -mx-1 flex justify-end border-t border-zinc-200 bg-white/95 px-1 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                        <button
                            type="button"
                            onClick={handleInsert}
                            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                        >
                            <Check className="h-4 w-4" />
                            Insert table
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
