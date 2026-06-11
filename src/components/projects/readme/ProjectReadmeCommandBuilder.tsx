"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, TerminalSquare } from "lucide-react";

import { extractProjectReadmeCommandShortcuts } from "@/lib/projects/readme-quick-console";
import { cn } from "@/lib/utils";

type CommandPresetId = "pnpm" | "npm" | "yarn" | "powershell" | "docker" | "git" | "custom";

const COMMAND_PRESETS: Array<{
    id: CommandPresetId;
    label: string;
    language: string;
    heading: string;
    command: string;
}> = [
    {
        id: "pnpm",
        label: "pnpm app",
        language: "bash",
        heading: "Install and run",
        command: "pnpm install\npnpm dev",
    },
    {
        id: "npm",
        label: "npm app",
        language: "bash",
        heading: "Install and run",
        command: "npm install\nnpm run dev",
    },
    {
        id: "yarn",
        label: "yarn app",
        language: "bash",
        heading: "Install and run",
        command: "yarn install\nyarn dev",
    },
    {
        id: "powershell",
        label: "PowerShell",
        language: "powershell",
        heading: "Windows",
        command: "npm install\nnpm run dev",
    },
    {
        id: "docker",
        label: "Docker",
        language: "bash",
        heading: "Docker",
        command: "docker compose up --build",
    },
    {
        id: "git",
        label: "Git",
        language: "bash",
        heading: "Clone repository",
        command: "git clone <repository-url>\ncd <project-folder>",
    },
    {
        id: "custom",
        label: "Custom",
        language: "bash",
        heading: "",
        command: "",
    },
];

const LANGUAGE_OPTIONS = [
    { value: "bash", label: "Bash" },
    { value: "sh", label: "Shell" },
    { value: "powershell", label: "PowerShell" },
    { value: "javascript", label: "JavaScript" },
    { value: "typescript", label: "TypeScript" },
    { value: "json", label: "JSON" },
    { value: "dockerfile", label: "Dockerfile" },
    { value: "text", label: "Plain text" },
];

function commentPrefixForLanguage(language: string) {
    if (language === "json") return "";
    if (language === "javascript" || language === "typescript") return "//";
    return "#";
}

function buildMarkdownCommand(language: string, heading: string, command: string) {
    const trimmedCommand = command.trimEnd();
    const commentPrefix = commentPrefixForLanguage(language);
    const comment = heading.trim() && commentPrefix ? `${commentPrefix} ${heading.trim()}\n` : "";
    return `\`\`\`${language}\n${comment}${trimmedCommand || "your command here"}\n\`\`\``;
}

function parseSelectedCommandBlock(value: string) {
    const match = value.match(/^\s*```([a-z0-9_-]*)\n([\s\S]*?)\n?```\s*$/i);
    if (!match) return null;
    const language = match[1]?.trim() || "bash";
    const body = match[2] ?? "";
    const lines = body.split("\n");
    const firstLine = lines[0]?.trim() ?? "";
    const commentMatch = firstLine.match(/^(?:#|\/\/)\s*(.+)$/);
    return {
        language,
        heading: commentMatch?.[1] ?? "",
        command: (commentMatch ? lines.slice(1) : lines).join("\n").trimEnd(),
    };
}

export function ProjectReadmeCommandBuilder({
    selectedMarkdown = "",
    onInsert,
    onClose,
}: {
    selectedMarkdown?: string;
    onInsert: (markdown: string) => void;
    onClose?: () => void;
}) {
    const selectedCommand = useMemo(() => parseSelectedCommandBlock(selectedMarkdown), [selectedMarkdown]);
    const [presetId, setPresetId] = useState<CommandPresetId>(selectedCommand ? "custom" : "pnpm");
    const [language, setLanguage] = useState(selectedCommand?.language ?? "bash");
    const [heading, setHeading] = useState(selectedCommand?.heading ?? "Install and run");
    const [command, setCommand] = useState(selectedCommand?.command ?? "pnpm install\npnpm dev");
    const preview = useMemo(() => buildMarkdownCommand(language, heading, command), [command, heading, language]);
    const inferredCommands = useMemo(() => extractProjectReadmeCommandShortcuts(preview), [preview]);
    const hasCommand = command.trim().length > 0;

    const applyPreset = (nextPresetId: CommandPresetId) => {
        const preset = COMMAND_PRESETS.find((item) => item.id === nextPresetId) ?? COMMAND_PRESETS[0];
        setPresetId(nextPresetId);
        setLanguage(preset?.language ?? "bash");
        setHeading(preset?.heading ?? "");
        setCommand(preset?.command ?? "");
    };

    const handleInsert = () => {
        if (!hasCommand) return;
        onInsert(`\n${preview}\n`);
        onClose?.();
    };

    return (
        <div className="space-y-8">
            <div>
                <p className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{selectedCommand ? "Edit selected command" : "Insert a command"}</p>
                <p className="mt-1.5 text-sm leading-6 text-zinc-500">
                    {selectedCommand
                        ? "The selected fenced command is loaded here so you can replace it cleanly."
                        : "Pick a common command style, edit it, and README will render it with a copy button."}
                </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {COMMAND_PRESETS.map((preset) => (
                    <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset.id)}
                        className={cn(
                            "rounded-2xl border p-3 text-left text-sm font-semibold transition",
                            presetId === preset.id
                                ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
                                : "border-zinc-200 text-zinc-700 hover:border-blue-300 dark:border-zinc-800 dark:text-zinc-300",
                        )}
                    >
                        <span className="flex items-center gap-2">
                            <TerminalSquare className="h-4 w-4" />
                            {preset.label}
                        </span>
                    </button>
                ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Language</span>
                    <select
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                        className="w-full rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800 dark:bg-zinc-950"
                    >
                        {LANGUAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
                <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Optional label</span>
                    <input
                        value={heading}
                        onChange={(event) => setHeading(event.target.value)}
                        className="w-full rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                        placeholder="macOS / Linux, Windows, Install, Run..."
                    />
                </label>
            </div>

            <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Command</span>
                <textarea
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    rows={6}
                    className="w-full resize-y rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                    placeholder="pnpm install&#10;pnpm dev"
                />
            </label>

            {!hasCommand ? (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Add at least one command so readers do not receive an empty copy block.</span>
                </div>
            ) : null}

            <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900/60">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Markdown preview</p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">{preview}</pre>
            </div>

            {inferredCommands.length ? (
                <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800" data-readme-command-intelligence="true">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Reader experience</p>
                    <div className="space-y-2">
                        {inferredCommands.map((item) => (
                            <div key={item.id} className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-900/50">
                                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-300">{item.label}</span>
                                    {item.platforms.map((platform) => (
                                        <span key={platform} className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">{platform}</span>
                                    ))}
                                    {item.ecosystemTags.map((tag) => (
                                        <span key={tag} className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">{tag}</span>
                                    ))}
                                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{item.confidenceLabel}</span>
                                    {item.riskLabel ? (
                                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{item.riskLabel}</span>
                                    ) : null}
                                </div>
                                <code className="block whitespace-pre-wrap break-words rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] leading-5 text-zinc-700 [overflow-wrap:anywhere] dark:bg-black/30 dark:text-zinc-300">{item.command}</code>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleInsert}
                    disabled={!hasCommand}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Check className="h-4 w-4" />
                    {selectedCommand ? "Replace command" : "Insert command"}
                </button>
            </div>
        </div>
    );
}
