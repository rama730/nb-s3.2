"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { projectReadmeEditorTargetId } from "@/lib/projects/readme-editor-source-map";
import { cn } from "@/lib/utils";

export type ProjectReadmeCommandLineTarget = {
    id: string;
    startLine: number;
    endLine: number;
};

async function copyTextWithFallback(value: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Clipboard fallback failed");
}

export function ProjectReadmeCommandBlock({
    code,
    language,
    id,
    editorTargetId,
    highlighted,
    highlightedTargetId,
    highlightToken,
    lineTargets = [],
    onCopied,
    sourceLine,
    sourceOffset,
}: {
    code: string;
    language?: string | null;
    id?: string;
    editorTargetId?: string | null;
    highlighted?: boolean;
    highlightedTargetId?: string | null;
    highlightToken?: number | null;
    lineTargets?: ProjectReadmeCommandLineTarget[];
    onCopied?: (id: string) => void;
    sourceLine?: number | null;
    sourceOffset?: number | null;
}) {
    const [copied, setCopied] = useState(false);
    const codeLines = code.trimEnd().split("\n");
    const lineTargetByStartLine = useMemo(() => {
        const map = new Map<number, ProjectReadmeCommandLineTarget>();
        lineTargets.forEach((target) => map.set(target.startLine, target));
        return map;
    }, [lineTargets]);
    const highlightedLineTarget = useMemo(
        () => lineTargets.find((target) => target.id === highlightedTargetId) ?? null,
        [highlightedTargetId, lineTargets],
    );
    const rootEditorTargetId = editorTargetId ?? projectReadmeEditorTargetId("command", sourceLine ?? null, sourceOffset ?? null);

    const handleCopy = async () => {
        if (id) onCopied?.(id);
        try {
            await copyTextWithFallback(code.trimEnd());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch (error) {
            console.error("[ProjectReadmeCommandBlock] Copy failed", error);
        }
    };

    return (
        <div
            id={id}
            tabIndex={id ? -1 : undefined}
            data-readme-target={id ? "true" : undefined}
            data-readme-target-kind={id ? "command" : undefined}
            data-readme-target-id={id}
            data-readme-command-block="true"
            data-readme-source-line={sourceLine ?? undefined}
            data-readme-source-offset={sourceOffset ?? undefined}
            data-readme-source-kind="command"
            data-readme-editor-target-id={rootEditorTargetId}
            data-readme-highlighted={highlighted || highlightedTargetId === rootEditorTargetId ? "true" : undefined}
            data-readme-highlight-token={highlighted || highlightedTargetId === rootEditorTargetId ? highlightToken ?? undefined : undefined}
            className={cn(
                "group relative my-4 scroll-mt-28 overflow-hidden rounded-md border border-zinc-200 bg-[#f6f8fa] text-zinc-950 shadow-none outline-none transition-[background-color,border-color,box-shadow] dark:border-zinc-800 dark:bg-[#161b22] dark:text-zinc-100",
                "focus-visible:ring-2 focus-visible:ring-blue-500/40",
                highlighted && "border-blue-400 bg-blue-50/80 shadow-[0_0_0_5px_rgba(59,130,246,0.22)] dark:border-blue-500/70 dark:bg-blue-500/20",
            )}
        >
            {language ? (
                <div className="border-b border-zinc-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    {language}
                </div>
            ) : null}
            <button
                type="button"
                onClick={handleCopy}
                data-readme-copy-button="true"
                title={copied ? "Copied" : "Copy"}
                aria-label={copied ? "Copied" : "Copy command"}
                className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white/90 text-zinc-500 transition hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="sr-only" aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
            </button>
            <pre className="whitespace-pre-wrap break-words px-4 py-4 pr-12 font-mono text-sm leading-6 [overflow-wrap:anywhere]">
                <code className="break-words [overflow-wrap:anywhere]">
                    {codeLines.map((line, index) => {
                        const target = lineTargetByStartLine.get(index);
                        const sourceLineForCode = typeof sourceLine === "number" ? sourceLine + index + 1 : null;
                        const lineEditorTargetId = projectReadmeEditorTargetId("command", sourceLineForCode, null);
                        const lineHighlighted = Boolean(
                            highlightedLineTarget
                            && index >= highlightedLineTarget.startLine
                            && index <= highlightedLineTarget.endLine,
                        ) || highlightedTargetId === lineEditorTargetId;
                        return (
                            <span
                                key={`${index}-${line}`}
                                id={target?.id}
                                tabIndex={target?.id ? -1 : undefined}
                                data-readme-target={target?.id ? "true" : undefined}
                                data-readme-target-kind={target?.id ? "command" : undefined}
                                data-readme-target-id={target?.id}
                                data-readme-source-line={sourceLineForCode ?? undefined}
                                data-readme-source-kind="command"
                                data-readme-editor-target-id={lineEditorTargetId}
                                data-readme-highlighted={lineHighlighted ? "true" : undefined}
                                data-readme-highlight-token={lineHighlighted ? highlightToken ?? undefined : undefined}
                                className={cn(
                                    "block min-w-0 scroll-mt-32 rounded-sm outline-none [overflow-wrap:anywhere]",
                                    lineHighlighted && "-mx-1 bg-blue-100/90 px-1 shadow-[0_0_0_3px_rgba(59,130,246,0.2)] dark:bg-blue-500/25",
                                )}
                            >
                                {line || " "}
                            </span>
                        );
                    })}
                </code>
            </pre>
        </div>
    );
}
