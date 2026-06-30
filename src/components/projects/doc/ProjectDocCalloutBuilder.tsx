"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Info, Lightbulb, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type CalloutKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

const CALLOUTS: Array<{
    id: CalloutKind;
    label: string;
    description: string;
    icon: typeof Info;
}> = [
    { id: "NOTE", label: "Note", description: "Useful context readers should know.", icon: Info },
    { id: "TIP", label: "Tip", description: "A helpful shortcut or recommendation.", icon: Lightbulb },
    { id: "IMPORTANT", label: "Important", description: "A detail that changes how users proceed.", icon: ShieldAlert },
    { id: "WARNING", label: "Warning", description: "Something that may cause issues.", icon: AlertTriangle },
    { id: "CAUTION", label: "Caution", description: "A higher-risk note before action.", icon: AlertTriangle },
];

function buildCalloutMarkdown(kind: CalloutKind, message: string) {
    const lines = (message.trim() || "Add the important note here.").split(/\r?\n/);
    return [`> [!${kind}]`, ...lines.map((line) => `> ${line}`)].join("\n");
}

export function ProjectDocCalloutBuilder({
    onInsert,
    onClose,
}: {
    onInsert: (markdown: string) => void;
    onClose?: () => void;
}) {
    const [kind, setKind] = useState<CalloutKind>("NOTE");
    const [message, setMessage] = useState("Add the important note here.");
    const preview = useMemo(() => buildCalloutMarkdown(kind, message), [kind, message]);

    const handleInsert = () => {
        onInsert(`\n${preview}\n`);
        onClose?.();
    };

    return (
        <div className="space-y-5">
            <div>
                <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Insert a callout</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Add a GitHub-style note, tip, warning, or important block without writing the syntax by hand.
                </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-5">
                {CALLOUTS.map((callout) => {
                    const Icon = callout.icon;
                    return (
                        <button
                            key={callout.id}
                            type="button"
                            onClick={() => setKind(callout.id)}
                            className={cn(
                                "rounded-2xl border p-3 text-left transition",
                                kind === callout.id
                                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
                                    : "border-zinc-200 text-zinc-700 hover:border-blue-300 dark:border-zinc-800 dark:text-zinc-300",
                            )}
                        >
                            <span className="flex items-center gap-2 text-sm font-semibold">
                                <Icon className="h-4 w-4" />
                                {callout.label}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-zinc-500">{callout.description}</span>
                        </button>
                    );
                })}
            </div>

            <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Message</span>
                <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={5}
                    className="w-full resize-y rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                    placeholder="Tell readers what they should notice."
                />
            </label>

            <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900/60">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Markdown preview</p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">{preview}</pre>
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleInsert}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                    <Check className="h-4 w-4" />
                    Insert callout
                </button>
            </div>
        </div>
    );
}
