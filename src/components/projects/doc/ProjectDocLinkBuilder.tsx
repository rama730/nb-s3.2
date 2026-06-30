"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Link2 } from "lucide-react";

function escapeMarkdownLinkText(value: string) {
    return value.replace(/\[/g, "\\[").replace(/\]/g, "\\]").trim();
}

function escapeMarkdownLinkTitle(value: string) {
    return value.replace(/"/g, '\\"').trim();
}

function buildMarkdownLink(text: string, url: string, title: string) {
    const safeText = escapeMarkdownLinkText(text || "Link text");
    const safeUrl = (url || "").trim().replace(/\s+/g, "%20");
    const safeTitle = escapeMarkdownLinkTitle(title);
    return safeTitle ? `[${safeText}](${safeUrl} "${safeTitle}")` : `[${safeText}](${safeUrl})`;
}

function validateReadmeLinkUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return "Add a URL before inserting the link.";
    if (trimmed.startsWith("/") || trimmed.startsWith("#")) return null;
    try {
        const parsed = new URL(trimmed);
        if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) return null;
    } catch {
        return "Use https://, mailto:, tel:, /relative-path, or #section links.";
    }
    return "Unsafe link protocol blocked. Use https://, mailto:, tel:, /relative-path, or #section.";
}

export function ProjectDocLinkBuilder({
    onInsert,
    onClose,
}: {
    onInsert: (markdown: string) => void;
    onClose?: () => void;
}) {
    const [text, setText] = useState("Project link");
    const [url, setUrl] = useState("");
    const [title, setTitle] = useState("");
    const preview = useMemo(() => buildMarkdownLink(text, url, title), [text, title, url]);
    const validationMessage = useMemo(() => validateReadmeLinkUrl(url), [url]);

    const handleInsert = () => {
        if (validationMessage) return;
        onInsert(preview);
        onClose?.();
    };

    return (
        <div className="space-y-5">
            <div>
                <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Insert a link</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Create a clean Markdown link for docs, demos, references, or support resources.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Display text</span>
                    <input
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        className="w-full rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                        placeholder="Install guide"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">URL</span>
                    <input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        className="w-full rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                        placeholder="https://example.com"
                    />
                </label>
            </div>

            <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Optional title</span>
                <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                    placeholder="Shown as hover text"
                />
            </label>

            {validationMessage ? (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{validationMessage}</span>
                </div>
            ) : null}

            <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900/60">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    <Link2 className="h-3.5 w-3.5" />
                    Markdown preview
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">{preview}</pre>
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleInsert}
                    disabled={Boolean(validationMessage)}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Check className="h-4 w-4" />
                    Insert link
                </button>
            </div>
        </div>
    );
}
