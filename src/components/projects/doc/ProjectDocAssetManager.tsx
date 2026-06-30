"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ImagePlus, Link2, Replace } from "lucide-react";

import { ProjectDocAssetUploader } from "@/components/projects/doc/ProjectDocAssetUploader";
import {
    buildProjectDocImageMarkdown,
    getProjectDocImageIntentOption,
    PROJECT_DOC_IMAGE_INTENTS,
    type ProjectDocImageIntent,
    type ProjectDocImageSourceKind,
} from "@/lib/projects/doc-media";
import { cn } from "@/lib/utils";

const IMAGE_SOURCE_MODES: Array<{
    id: ProjectDocImageSourceKind;
    label: string;
    description: string;
}> = [
    {
        id: "managed",
        label: "Upload",
        description: "Best for private or app-owned document media.",
    },
    {
        id: "project-file",
        label: "Project file",
        description: "Use a portable relative path already in the repo.",
    },
    {
        id: "github-path",
        label: "GitHub path",
        description: "Insert a repo-relative image path from an imported GitHub project.",
    },
    {
        id: "external-url",
        label: "External URL",
        description: "Use only for stable public images you trust.",
    },
    {
        id: "replacement",
        label: "Replace",
        description: "Select existing image syntax, then insert the replacement.",
    },
];

function defaultSourcePlaceholder(mode: ProjectDocImageSourceKind) {
    if (mode === "external-url") return "https://example.com/screenshot.png";
    if (mode === "replacement") return "docs/assets/new-image.png";
    return "docs/assets/screenshot.png";
}

function parseSelectedImageMarkup(value: string) {
    const markdown = value.match(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/i);
    if (markdown) return { alt: markdown[1] ?? "", src: markdown[2] ?? "" };
    const html = value.match(/<img\b[^>]*>/i)?.[0];
    if (!html) return null;
    const readAttr = (name: string) => {
        const match = html.match(new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))", "i"));
        return match?.[2] ?? match?.[3] ?? match?.[4] ?? "";
    };
    return { alt: readAttr("alt"), src: readAttr("src") };
}

export function ProjectDocAssetManager({
    projectId,
    projectVisibility,
    selectedMarkdown = "",
    onInserted,
}: {
    projectId: string;
    projectVisibility?: string | null;
    selectedMarkdown?: string;
    onInserted: (markdown: string) => void;
}) {
    const selectedImage = useMemo(() => parseSelectedImageMarkup(selectedMarkdown), [selectedMarkdown]);
    const [intent, setIntent] = useState<ProjectDocImageIntent>("screenshot");
    const [sourceMode, setSourceMode] = useState<ProjectDocImageSourceKind>(selectedImage ? "replacement" : "managed");
    const [src, setSrc] = useState(selectedImage?.src ?? "");
    const [altText, setAltText] = useState(selectedImage?.alt ?? "");
    const [caption, setCaption] = useState("");
    const [customWidth, setCustomWidth] = useState("");
    const intentOption = getProjectDocImageIntentOption(intent);
    const displayWidth = useMemo(() => {
        const parsed = Number(customWidth);
        if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
        return intentOption?.defaultWidth;
    }, [customWidth, intentOption?.defaultWidth]);
    const generatedMarkdown = useMemo(() => buildProjectDocImageMarkdown({
        src,
        alt: altText,
        intent,
        width: displayWidth,
        caption,
    }), [altText, caption, displayWidth, intent, src]);
    const canInsertManualImage = sourceMode !== "managed" && src.trim() && altText.trim();
    const privacyCopy = projectVisibility === "public"
        ? "Public document media can use managed upload or stable repo-relative paths."
        : "Private projects should prefer managed upload so media follows project access rules.";

    useEffect(() => {
        if (!selectedImage) return;
        setSourceMode("replacement");
        setSrc((current) => current || selectedImage.src);
        setAltText((current) => current || selectedImage.alt);
    }, [selectedImage]);

    return (
        <div className="space-y-4" data-readme-asset-manager="true" data-readme-image-intent-picker="true">
            <div className="flex items-start gap-3">
                <span className="rounded-2xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                    <ImagePlus className="h-4 w-4" />
                </span>
                <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Document image</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {selectedImage
                            ? "A selected image is ready to replace. Choose the new purpose, source, width, and alt text."
                            : "Choose the image purpose first so the inserted Markdown has the right width, alignment, and alt text."}
                    </p>
                </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PROJECT_DOC_IMAGE_INTENTS.map((option) => {
                    const active = option.id === intent;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => setIntent(option.id)}
                            className={cn(
                                "rounded-2xl border p-3 text-left transition",
                                active
                                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-200"
                                    : "border-zinc-200 hover:border-blue-300 dark:border-zinc-800 dark:hover:border-blue-800",
                            )}
                        >
                            <span className="text-sm font-semibold">{option.label}</span>
                            <span className="mt-1 block text-xs leading-5 opacity-80">{option.description}</span>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Source</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {IMAGE_SOURCE_MODES.map((mode) => {
                        const active = mode.id === sourceMode;
                        return (
                            <button
                                key={mode.id}
                                type="button"
                                onClick={() => {
                                    setSourceMode(mode.id);
                                }}
                                className={cn(
                                    "rounded-2xl border px-3 py-2 text-left transition",
                                    active
                                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-200"
                                        : "border-zinc-200 hover:border-blue-300 dark:border-zinc-800 dark:hover:border-blue-800",
                                )}
                            >
                                <span className="flex items-center gap-1.5 text-xs font-semibold">
                                    {mode.id === "replacement" ? <Replace className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                                    {mode.label}
                                </span>
                                <span className="mt-1 block text-[11px] leading-4 opacity-75">{mode.description}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {sourceMode === "managed" ? (
                <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <ProjectDocAssetUploader
                        projectId={projectId}
                        projectVisibility={projectVisibility}
                        imageIntent={intent}
                        displayWidth={displayWidth}
                        caption={caption}
                        onInserted={onInserted}
                    />
                    <label className="mt-3 block space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Optional caption</span>
                        <input
                            value={caption}
                            onChange={(event) => setCaption(event.target.value)}
                            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                            placeholder="Short caption under the image"
                        />
                    </label>
                    <label className="mt-3 block space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Display width</span>
                        <input
                            value={customWidth}
                            onChange={(event) => setCustomWidth(event.target.value.replace(/[^\d]/g, ""))}
                            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                            placeholder={intentOption?.defaultWidth ? String(intentOption.defaultWidth) : "Auto"}
                            inputMode="numeric"
                        />
                    </label>
                </div>
            ) : (
                <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="grid gap-3 sm:grid-cols-2">
                        {sourceMode === "replacement" && selectedImage ? (
                            <div className="sm:col-span-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300">
                                Selected image source will be replaced when you insert the new markup.
                            </div>
                        ) : null}
                        <label className="block space-y-1 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Image source</span>
                            <input
                                value={src}
                                onChange={(event) => setSrc(event.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                                placeholder={defaultSourcePlaceholder(sourceMode)}
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Alt text</span>
                            <input
                                value={altText}
                                onChange={(event) => setAltText(event.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                                placeholder="Describe the image"
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Display width</span>
                            <input
                                value={customWidth}
                                onChange={(event) => setCustomWidth(event.target.value.replace(/[^\d]/g, ""))}
                                className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                                placeholder={intentOption?.defaultWidth ? String(intentOption.defaultWidth) : "Auto"}
                                inputMode="numeric"
                            />
                        </label>
                        <label className="block space-y-1 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Optional caption</span>
                            <input
                                value={caption}
                                onChange={(event) => setCaption(event.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                                placeholder="Short caption under the image"
                            />
                        </label>
                    </div>

                    <div className="mt-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Markdown</p>
                        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                            {generatedMarkdown || "Add a source and alt text to generate portable document image markup."}
                        </pre>
                    </div>
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            disabled={!canInsertManualImage}
                            onClick={() => onInserted(`\n${generatedMarkdown}\n`)}
                            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Check className="h-3.5 w-3.5" />
                            Insert image
                        </button>
                    </div>
                </div>
            )}

            <ul className="space-y-1 text-xs leading-5 text-zinc-500">
                <li>{privacyCopy}</li>
                <li>Use repo-relative paths for GitHub portability; use managed upload when access control matters.</li>
                <li>Large screenshots and diagrams receive stable display widths to prevent oversized document images.</li>
            </ul>
        </div>
    );
}
