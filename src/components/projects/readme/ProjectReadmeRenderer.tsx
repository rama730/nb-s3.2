"use client";

import React, { Suspense, useMemo, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import {
    normalizeReadmeReferenceLabel,
    parseReadmeReferenceHref,
    readmeReferenceHref,
    replaceInlineReadmeReferencesWithMarkdown,
    type ProjectReadmeReferenceKind,
    type ProjectReadmeReferenceOption,
    type ProjectReadmeSmartBlockPreview,
} from "@/lib/projects/readme-blocks";
import { buildProjectReadmePlainText } from "@/lib/projects/readme-plain-text";
import { slugifyReadmeHeading } from "@/lib/projects/readme-headings";
import {
    projectReadmeReferenceTargetId,
} from "@/lib/projects/readme-navigation";
import {
    projectReadmeEditorTargetId,
    type ProjectReadmeEditorSourcePosition,
    type ProjectReadmeEditorTargetKind,
} from "@/lib/projects/readme-editor-source-map";
import { resolveProjectReadmeImage, type ProjectReadmeImageKind } from "@/lib/projects/readme-media";
import { buildProjectReadmeViewModel, type ProjectReadmeViewModel } from "@/lib/projects/readme-view-model";
import { ProjectReadmeCommandBlock } from "@/components/projects/readme/ProjectReadmeCommandBlock";
import { ProjectReadmeSmartBlock } from "@/components/projects/readme/ProjectReadmeSmartBlock";
import { useProjectReadmeSmartBlockPreviews } from "@/hooks/hub/useProjectReadmeData";
import type { Project } from "@/types/hub";
import { cn } from "@/lib/utils";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });

function splitMarkdownIntoSections(content: string): string[] {
    const lines = content.split("\n");
    const sections: string[] = [];
    let currentSection: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
        }

        // Split on H1 or H2 headings only if not in a code block
        if (!inCodeBlock && /^(?:#{1,2})\s+/.test(line)) {
            if (currentSection.length > 0) {
                sections.push(currentSection.join("\n"));
                currentSection = [];
            }
        }
        currentSection.push(line);
    }
    if (currentSection.length > 0) {
        sections.push(currentSection.join("\n"));
    }
    return sections;
}

function extractReferenceLinks(content: string): string {
    const lines = content.split("\n");
    const linkLines: string[] = [];
    let inCodeBlock = false;
    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
        }
        if (!inCodeBlock && /^\s*\[[^\]]+\]:\s*\S+/.test(line)) {
            linkLines.push(line);
        }
    }
    return linkLines.join("\n");
}

const MemoizedMarkdownSegment = React.memo(function MemoizedMarkdownSegment({
    content,
    components,
    renderSignature,
}: {
    content: string;
    components: any;
    renderSignature: string;
}) {
    void renderSignature;
    return (
        <ReactMarkdown
            rehypePlugins={README_REHYPE_PLUGINS as any}
            remarkPlugins={[remarkGfm]}
            skipHtml={false}
            components={components}
        >
            {replaceInlineReadmeReferencesWithMarkdown(content)}
        </ReactMarkdown>
    );
}, (previous, next) => (
    previous.content === next.content
    && previous.renderSignature === next.renderSignature
));

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const README_HTML_ALIGN_VALUES = ["left", "right", "center", "justify"];
const README_HTML_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        "*": [
            ...(defaultSchema.attributes?.["*"] ?? []),
            ["align", ...README_HTML_ALIGN_VALUES],
            "title",
        ],
        a: [
            ...(defaultSchema.attributes?.a ?? []),
            "href",
            "title",
        ],
        img: [
            ...(defaultSchema.attributes?.img ?? []),
            "src",
            "alt",
            "title",
            "width",
            "height",
        ],
    },
    protocols: {
        ...defaultSchema.protocols,
        href: ["http", "https", "mailto", "tel"],
        src: ["http", "https"],
    },
};
const README_REHYPE_PLUGINS = [
    rehypeRaw,
    [rehypeSanitize, README_HTML_SANITIZE_SCHEMA],
] as const;
const README_MEDIA_MAX_WIDTH_BY_KIND: Record<ProjectReadmeImageKind, number> = {
    badge: 180,
    icon: 48,
    logo: 220,
    diagram: 980,
    content: 980,
};

type MarkdownAstNode = {
    position?: {
        start?: {
            line?: number;
            offset?: number;
        };
    };
};

function sourceTargetProps(
    kind: ProjectReadmeEditorTargetKind,
    node?: MarkdownAstNode,
    highlightedTargetId?: string | null,
) {
    const line = node?.position?.start?.line ?? null;
    const offset = node?.position?.start?.offset ?? null;
    const targetId = projectReadmeEditorTargetId(kind, line, offset);
    return {
        "data-readme-source-line": line ?? undefined,
        "data-readme-source-offset": offset ?? undefined,
        "data-readme-source-kind": kind,
        "data-readme-editor-target-id": targetId,
        "data-readme-highlighted": highlightedTargetId === targetId ? "true" : undefined,
    };
}

function sourceHighlightClass(highlighted: boolean) {
    return highlighted
        ? "bg-blue-100/80 shadow-[0_0_0_4px_rgba(59,130,246,0.2)] dark:bg-blue-500/20"
        : "";
}

function ProjectReadmeInlineReferenceChip({
    fallback,
    option,
    reference,
    targetId,
    highlighted,
    highlightToken,
    onRequestTarget,
}: {
    fallback: React.ReactNode;
    option?: ProjectReadmeReferenceOption | null;
    reference?: { kind: ProjectReadmeReferenceKind; id: string } | null;
    targetId?: string | null;
    highlighted?: boolean;
    highlightToken?: number | null;
    onRequestTarget?: (targetId: string) => void;
}) {
    const kind = option?.kind ?? reference?.kind ?? null;
    const fallbackText = kind
        ? normalizeReadmeReferenceLabel(kind, textFromReactNode(fallback) || "")
        : textFromReactNode(fallback) || "Project reference";
    const label = kind
        ? normalizeReadmeReferenceLabel(kind, option?.title || fallbackText)
        : option?.title || fallbackText;
    const status = option?.status || option?.kindLabel || null;
    const meta = option?.meta || option?.subtitle || null;
    const detail = option?.context || [status, meta].filter(Boolean).join(" · ");
    const isContributor = kind === "contributors";
    const content = (
        <>
            {option?.avatarUrl ? (
                <img src={option.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover align-[-0.2rem]" />
            ) : isContributor ? (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/15 text-[9px] font-bold text-blue-500 align-[-0.2rem]">
                    {label.charAt(0).toUpperCase()}
                </span>
            ) : null}
            <span className="font-semibold text-blue-600 dark:text-blue-300">{label}</span>
        </>
    );
    const className = cn(
        "mx-0.5 inline-flex max-w-full cursor-pointer items-baseline gap-1 rounded-sm align-baseline text-sm leading-[inherit] no-underline outline-none transition-[background-color,box-shadow,color] hover:text-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40",
        highlighted && "bg-blue-100/80 shadow-[0_0_0_4px_rgba(59,130,246,0.22)] dark:bg-blue-500/20",
    );
    const title = [label, detail].filter(Boolean).join(" · ");
    const targetProps = targetId
        ? {
            id: targetId,
            "data-readme-target": "true",
            "data-readme-target-kind": "reference",
            "data-readme-target-id": targetId,
            "data-readme-highlight-token": highlighted ? highlightToken ?? undefined : undefined,
        }
        : {};

    if (targetId && onRequestTarget) {
        return (
            <a
                href={`#${encodeURIComponent(targetId)}`}
                className={className}
                title={title}
                onClick={(event) => {
                    event.preventDefault();
                    onRequestTarget(targetId);
                }}
                {...targetProps}
            >
                {content}
            </a>
        );
    }

    if (option?.href) {
        return (
            <a href={option.href} className={className} title={title} {...targetProps}>
                {content}
            </a>
        );
    }

    return (
        <span className={className} title={title} tabIndex={targetId ? -1 : undefined} {...targetProps}>
            {content}
        </span>
    );
}

function textFromReactNode(node: React.ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textFromReactNode).join("");
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textFromReactNode(node.props.children);
    return "";
}

function sanitizeMarkdownUrl(raw: string, allowRelative: boolean, isImage: boolean, allowExternalImages: boolean): string {
    const value = raw.replace(CONTROL_CHARS_REGEX, "").trim();
    if (!value) return "";
    if (value.startsWith("#")) return allowRelative ? value : "";
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
        if (!allowRelative && !value.startsWith("/api/v1/projects/")) return "";
        if (value.startsWith("//")) return "";
        return value;
    }
    try {
        const parsed = new URL(value);
        const allowedProtocols = isImage ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS;
        if (!allowedProtocols.has(parsed.protocol)) return "";
        if (isImage && !allowExternalImages) return "";
        return parsed.toString();
    } catch {
        return "";
    }
}

function readmeMediaStyle(input: ReturnType<typeof resolveProjectReadmeImage>): CSSProperties {
    const maxWidth = README_MEDIA_MAX_WIDTH_BY_KIND[input.kind];
    const style: CSSProperties = {
        maxWidth: "100%",
        height: "auto",
    };
    if (input.widthPercent) {
        style.width = `${input.widthPercent}%`;
    } else if (input.width) {
        style.width = `${Math.min(input.width, maxWidth)}px`;
    } else if (input.kind === "badge") {
        style.maxHeight = "22px";
    } else if (input.kind === "icon") {
        style.maxHeight = "24px";
    }
    if (input.height && (input.kind === "badge" || input.kind === "icon")) {
        style.height = `${Math.min(input.height, input.kind === "badge" ? 24 : 48)}px`;
        style.width = input.width ? `${Math.min(input.width, maxWidth)}px` : "auto";
    }
    return style;
}

function readmeMediaClass(kind: ProjectReadmeImageKind, highlighted: boolean) {
    return cn(
        "transition-[background-color,box-shadow,opacity] outline-none",
        kind === "badge" && "mx-0.5 my-1 inline-block rounded-none border-0 align-middle shadow-none",
        kind === "icon" && "mx-0.5 my-0 inline-block rounded-none border-0 align-[-0.2rem] shadow-none",
        kind === "logo" && "my-3 inline-block rounded-none border-0 shadow-none",
        kind === "diagram" && "my-5 block h-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-800",
        kind === "content" && "my-4 block h-auto rounded-md border border-zinc-200 dark:border-zinc-800",
        highlighted && "bg-blue-100/80 shadow-[0_0_0_4px_rgba(59,130,246,0.22)] dark:bg-blue-500/20",
    );
}

function readmeHiddenMediaClass(kind: ProjectReadmeImageKind, highlighted: boolean) {
    return cn(
        "text-zinc-500 transition-[background-color,box-shadow] dark:text-zinc-500",
        (kind === "badge" || kind === "icon")
            ? "mx-1 inline-flex max-w-full items-center rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] leading-4 align-middle dark:border-zinc-700"
            : "my-3 flex max-w-full items-center rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs leading-5 dark:border-zinc-700",
        highlighted && "bg-blue-100/80 shadow-[0_0_0_4px_rgba(59,130,246,0.2)] dark:bg-blue-500/20",
    );
}

export const ProjectReadmeRenderer = React.memo(function ProjectReadmeRenderer({
    content,
    project,
    allowExternalImages = false,
    allowSmartBlocks = true,
    editorMode = false,
    fidelity = "app",
    className,
    highlightedTargetId,
    highlightedTargetToken,
    onMediaLoad,
    onRequestTarget,
    onRequestSourcePosition,
    previewsLoading,
    previewByKey,
    viewModel,
}: {
    content: string;
    project: Project;
    allowExternalImages?: boolean;
    allowSmartBlocks?: boolean;
    editorMode?: boolean;
    fidelity?: "app" | "github";
    className?: string;
    highlightedTargetId?: string | null;
    highlightedTargetToken?: number | null;
    onMediaLoad?: () => void;
    onRequestTarget?: (targetId: string) => void;
    onRequestSourcePosition?: (position: ProjectReadmeEditorSourcePosition) => void;
    previewsLoading?: boolean;
    previewByKey?: Map<string, ProjectReadmeSmartBlockPreview>;
    viewModel?: ProjectReadmeViewModel;
}) {
    const readmeModel = useMemo(() => viewModel ?? buildProjectReadmeViewModel({ content }), [content, viewModel]);
    const segments = readmeModel.segments;
    const headingTargets = readmeModel.headings;
    const headingTargetQueues = useMemo(() => {
        const queues = new Map<string, string[]>();
        headingTargets.forEach((heading) => {
            const key = buildProjectReadmePlainText(heading.text, { maxLength: 120, stripCodeBlocks: false }) ?? heading.text;
            queues.set(key, [...(queues.get(key) ?? []), heading.id]);
        });
        return queues;
    }, [headingTargets]);
    const inlineReferences = readmeModel.references;
    const blocks = allowSmartBlocks ? readmeModel.previewBlocks : readmeModel.referencePreviewBlocks;
    const commandTargetMaps = readmeModel.commandTargetMaps;
    const previewsQuery = useProjectReadmeSmartBlockPreviews(project.id, blocks, !previewByKey && blocks.length > 0);
    const fallbackPreviewByKey = useMemo(() => {
        const map = new Map<string, NonNullable<typeof previewsQuery.data>[number]>();
        for (const preview of previewsQuery.data ?? []) {
            map.set(preview.key, preview);
            const parts = preview.key.split(":");
            if (parts.length >= 2) {
                map.set(`${parts[0]}:${parts[1]}`, preview);
            }
        }
        return map;
    }, [previewsQuery.data]);
    const effectivePreviewByKey = previewByKey ?? fallbackPreviewByKey;
    const effectivePreviewsLoading = typeof previewsLoading === "boolean" ? previewsLoading : previewsQuery.isLoading;
    const previewRenderSignature = useMemo(() => (
        Array.from(effectivePreviewByKey.entries())
            .map(([key, preview]) => `${key}:${preview.items.map((item) => `${item.id}:${item.title}:${item.status ?? ""}`).join(",")}`)
            .join("|")
    ), [effectivePreviewByKey]);
    React.useEffect(() => {
        if (typeof document === "undefined") return;

        // Clean up previous highlights
        const highlightedEls = document.querySelectorAll("[data-readme-highlighted='true']");
        highlightedEls.forEach((el) => {
            el.removeAttribute("data-readme-highlighted");
            el.removeAttribute("data-readme-highlight-token");
            el.classList.remove(
                "bg-blue-100/80", 
                "shadow-[0_0_0_4px_rgba(59,130,246,0.2)]", 
                "dark:bg-blue-500/20",
                "-mx-2", 
                "px-2", 
                "border-blue-400", 
                "bg-blue-100/90", 
                "ring-2", 
                "ring-blue-400/45", 
                "shadow-[0_0_0_5px_rgba(59,130,246,0.24)]", 
                "dark:border-blue-400", 
                "dark:bg-blue-500/30", 
                "dark:ring-blue-400/45"
            );
        });

        if (!highlightedTargetId) return;

        // Find target element by selector
        const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function" 
            ? CSS.escape(highlightedTargetId) 
            : highlightedTargetId.replace(/["\\#.:,[\]=]/g, "\\$&");
        const selector = `#${escapedId}, [data-readme-editor-target-id="${escapedId}"], [data-readme-target-id="${escapedId}"]`;
        const targetEls = document.querySelectorAll(selector);

        targetEls.forEach((el) => {
            el.setAttribute("data-readme-highlighted", "true");
            if (highlightedTargetToken) {
                el.setAttribute("data-readme-highlight-token", String(highlightedTargetToken));
            }

            const kind = el.getAttribute("data-readme-source-kind") || el.getAttribute("data-readme-target-kind");
            const isHeading = kind === "heading" || ["H1", "H2", "H3", "H4"].includes(el.tagName);

            if (isHeading) {
                el.classList.add(
                    "-mx-2", 
                    "px-2", 
                    "border-blue-400", 
                    "bg-blue-100/90", 
                    "ring-2", 
                    "ring-blue-400/45", 
                    "shadow-[0_0_0_5px_rgba(59,130,246,0.24)]", 
                    "dark:border-blue-400", 
                    "dark:bg-blue-500/30", 
                    "dark:ring-blue-400/45"
                );
            } else {
                el.classList.add(
                    "bg-blue-100/80", 
                    "shadow-[0_0_0_4px_rgba(59,130,246,0.2)]", 
                    "dark:bg-blue-500/20"
                );
            }
        });
    }, [highlightedTargetId, highlightedTargetToken]);

    const markdownRenderSignature = `${fidelity}:${allowExternalImages ? "external" : "safe"}:${previewRenderSignature}`;
    const inlineReferenceEntriesByHref = useMemo(() => {
        const map = new Map<string, Array<{
            targetId: string;
            option?: ProjectReadmeReferenceOption | null;
            reference: { kind: ProjectReadmeReferenceKind; id: string };
        }>>();
        inlineReferences.forEach((reference, index) => {
            const key = `${reference.kind}:${reference.id}:${index}`;
            const stableKey = `${reference.kind}:${reference.id}`;
            const option = (effectivePreviewByKey.get(key) ?? effectivePreviewByKey.get(stableKey))?.items[0];
            const href = readmeReferenceHref(reference.kind, reference.id);
            const entries = map.get(href) ?? [];
            entries.push({
                targetId: projectReadmeReferenceTargetId(reference.kind, reference.id, index),
                option,
                reference,
            });
            map.set(href, entries);
        });
        return map;
    }, [effectivePreviewByKey, inlineReferences]);
    const fallbackHeadingIds = new Set<string>();
    const headingRenderCounts = new Map<string, number>();
    const inlineReferenceRenderCounts = new Map<string, number>();
    const codeBlockRenderCounts = new Map<number, number>();
    const inlineCodeRenderCounts = new Map<number, number>();

    const renderHeading = (
        Tag: "h1" | "h2" | "h3" | "h4",
        children: React.ReactNode,
        id: string | undefined,
        className: string,
        node: MarkdownAstNode | undefined,
        props: React.HTMLAttributes<HTMLHeadingElement>,
    ) => {
        const headingText = buildProjectReadmePlainText(textFromReactNode(children), { maxLength: 120, stripCodeBlocks: false }) ?? textFromReactNode(children);
        const occurrenceIndex = headingRenderCounts.get(headingText) ?? 0;
        headingRenderCounts.set(headingText, occurrenceIndex + 1);
        const targetId = id || headingTargetQueues.get(headingText)?.[occurrenceIndex] || slugifyReadmeHeading(headingText, fallbackHeadingIds);
        const sourceProps = sourceTargetProps("heading", node, highlightedTargetId);
        const highlighted = highlightedTargetId === targetId || highlightedTargetId === sourceProps["data-readme-editor-target-id"];
        return (
            <Tag
                id={targetId}
                tabIndex={-1}
                {...sourceProps}
                data-readme-target="true"
                data-readme-target-kind="heading"
                data-readme-target-id={targetId}
                data-readme-highlighted={highlighted ? "true" : undefined}
                data-readme-highlight-token={highlighted ? highlightedTargetToken ?? undefined : undefined}
                className={cn(
                    className,
                    "rounded-md outline-none transition-[background-color,box-shadow,color]",
                    "focus-visible:ring-2 focus-visible:ring-blue-500/40",
                    highlighted && "-mx-2 px-2 border-blue-400 bg-blue-100/90 ring-2 ring-blue-400/45 shadow-[0_0_0_5px_rgba(59,130,246,0.24)] dark:border-blue-400 dark:bg-blue-500/30 dark:ring-blue-400/45",
                )}
                {...props}
            >
                {children}
            </Tag>
        );
    };

    const components = {
        h1: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h1", children, id, cn("mb-4 scroll-mt-24 border-b border-zinc-200 pb-2 font-semibold dark:border-zinc-800", fidelity === "github" ? "text-[2em] leading-tight" : "text-2xl"), node, props),
        h2: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h2", children, id, cn("mb-3 mt-7 scroll-mt-24 border-b border-zinc-200 pb-2 font-semibold dark:border-zinc-800", fidelity === "github" ? "text-[1.5em] leading-snug" : "text-xl"), node, props),
        h3: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h3", children, id, "mb-2 mt-5 scroll-mt-24 text-lg font-semibold", node, props),
        h4: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h4", children, id, "mb-2 mt-4 scroll-mt-24 text-base font-semibold", node, props),
        p: ({ node, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("paragraph", node, highlightedTargetId);
            return (
                <p
                    className={cn("mb-3 rounded-md text-sm leading-6 text-zinc-700 transition-[background-color,box-shadow] dark:text-zinc-300", sourceHighlightClass(Boolean(sourceProps["data-readme-highlighted"])))}
                    {...sourceProps}
                    {...props}
                />
            );
        },
        ul: ({ node, ...props }: React.HTMLAttributes<HTMLUListElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("list", node, highlightedTargetId);
            return <ul className={cn("mb-3 rounded-md list-disc space-y-1 pl-5 text-sm text-zinc-700 transition-[background-color,box-shadow] dark:text-zinc-300", sourceHighlightClass(Boolean(sourceProps["data-readme-highlighted"])))} {...sourceProps} {...props} />;
        },
        ol: ({ node, ...props }: React.HTMLAttributes<HTMLOListElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("list", node, highlightedTargetId);
            return <ol className={cn("mb-3 rounded-md list-decimal space-y-1 pl-5 text-sm text-zinc-700 transition-[background-color,box-shadow] dark:text-zinc-300", sourceHighlightClass(Boolean(sourceProps["data-readme-highlighted"])))} {...sourceProps} {...props} />;
        },
        blockquote: ({ node, ...props }: React.HTMLAttributes<HTMLQuoteElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("blockquote", node, highlightedTargetId);
            return <blockquote className={cn("my-4 rounded-md border-l-4 border-zinc-300 pl-4 text-sm text-zinc-600 transition-[background-color,box-shadow] dark:border-zinc-700 dark:text-zinc-400", sourceHighlightClass(Boolean(sourceProps["data-readme-highlighted"])))} {...sourceProps} {...props} />;
        },
        a: ({ href, rel, target, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
            const reference = parseReadmeReferenceHref(typeof href === "string" ? href : null);
            if (reference && href) {
                const count = inlineReferenceRenderCounts.get(href) ?? 0;
                inlineReferenceRenderCounts.set(href, count + 1);
                const entry = inlineReferenceEntriesByHref.get(href)?.[count] ?? null;
                const targetId = entry?.targetId ?? projectReadmeReferenceTargetId(reference.kind, reference.id, count);
                return (
                    <ProjectReadmeInlineReferenceChip
                        fallback={props.children}
                        highlighted={highlightedTargetId === targetId}
                        highlightToken={highlightedTargetId === targetId ? highlightedTargetToken : null}
                        onRequestTarget={onRequestTarget}
                        option={entry?.option}
                        reference={entry?.reference ?? reference}
                        targetId={targetId}
                    />
                );
            }
            const safeHref = typeof href === "string" ? sanitizeMarkdownUrl(href, true, false, allowExternalImages) : "";
            if (!safeHref) return <span className="text-zinc-500">{props.children}</span>;
            const isExternal = /^https?:\/\//i.test(safeHref);
            const isReadmeTarget = safeHref.startsWith("#") && safeHref.length > 1;
            return (
                <a
                    href={safeHref}
                    onClick={isReadmeTarget && onRequestTarget ? (event) => {
                        event.preventDefault();
                        onRequestTarget(safeHref.slice(1));
                    } : undefined}
                    rel={isExternal ? "noopener noreferrer" : rel}
                    target={isExternal ? "_blank" : target}
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    {...props}
                />
            );
        },
        code: ({ className: codeClassName, children, node, ...props }: React.HTMLAttributes<HTMLElement> & {
            node?: MarkdownAstNode;
        }) => {
            const match = /language-([a-z0-9_-]+)/i.exec(codeClassName || "");
            const value = String(children ?? "");
            const offset = node?.position?.start?.offset;
            const line = node?.position?.start?.line;
            if (!match) {
                const inlineCommandId = typeof line === "number"
                    ? (() => {
                        const occurrence = inlineCodeRenderCounts.get(line) ?? 0;
                        inlineCodeRenderCounts.set(line, occurrence + 1);
                        return commandTargetMaps.inlineByLineQueue.get(line)?.[occurrence] ?? commandTargetMaps.inlineByLine.get(line);
                    })()
                    : typeof offset === "number"
                        ? commandTargetMaps.inlineByOffset.get(offset)
                        : undefined;
                const sourceProps = sourceTargetProps("inline-code", node, highlightedTargetId);
                const inlineCommandHighlighted = highlightedTargetId === inlineCommandId || Boolean(sourceProps["data-readme-highlighted"]);
                return (
                    <code
                        id={inlineCommandId}
                        tabIndex={inlineCommandId ? -1 : undefined}
                        {...sourceProps}
                        data-readme-target={inlineCommandId ? "true" : undefined}
                        data-readme-target-kind={inlineCommandId ? "command" : undefined}
                        data-readme-target-id={inlineCommandId}
                        data-readme-highlighted={inlineCommandHighlighted ? "true" : undefined}
                        data-readme-highlight-token={inlineCommandHighlighted ? highlightedTargetToken ?? undefined : undefined}
                        className={cn(
                            "rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.9em] text-zinc-900 outline-none transition-[background-color,box-shadow,color] dark:bg-zinc-800 dark:text-zinc-100",
                            inlineCommandHighlighted && "bg-blue-100/80 shadow-[0_0_0_4px_rgba(59,130,246,0.22)] dark:bg-blue-500/20",
                        )}
                        {...props}
                    >
                        {children}
                    </code>
                );
            }
            const commandId = typeof line === "number"
                ? (() => {
                    const occurrence = codeBlockRenderCounts.get(line) ?? 0;
                    codeBlockRenderCounts.set(line, occurrence + 1);
                    return commandTargetMaps.byLineQueue.get(line)?.[occurrence] ?? commandTargetMaps.byLine.get(line);
                })()
                : typeof offset === "number"
                    ? commandTargetMaps.byOffset.get(offset)
                    : undefined;
            const lineTargets = commandId
                ? readmeModel.commands
                    .filter((command) => command.blockId === commandId && command.targetKind === "block" && command.targetId !== command.blockId && command.codeLineStart !== null && command.codeLineEnd !== null)
                    .map((command) => ({
                        id: command.targetId,
                        startLine: command.codeLineStart ?? 0,
                        endLine: command.codeLineEnd ?? command.codeLineStart ?? 0,
                    }))
                : [];
            const sourceProps = sourceTargetProps("command", node, highlightedTargetId);
            const blockHighlighted = highlightedTargetId === commandId || Boolean(sourceProps["data-readme-highlighted"]);
            const lineTargetHighlighted = lineTargets.some((target) => target.id === highlightedTargetId);
            return (
                <ProjectReadmeCommandBlock
                    id={commandId}
                    code={value}
                    editorTargetId={sourceProps["data-readme-editor-target-id"]}
                    highlighted={blockHighlighted}
                    highlightedTargetId={highlightedTargetId}
                    highlightToken={blockHighlighted || lineTargetHighlighted ? highlightedTargetToken : null}
                    language={match[1]}
                    lineTargets={lineTargets}
                    onCopied={commandId ? onRequestTarget : undefined}
                    sourceLine={line ?? null}
                    sourceOffset={offset ?? null}
                />
            );
        },
        img: ({ src, alt = "", title, width, height, node }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: MarkdownAstNode }) => {
            const image = resolveProjectReadmeImage({
                src,
                alt,
                title,
                width,
                height,
                allowExternalImages,
                project,
            });
            const sourceProps = sourceTargetProps("image", node, highlightedTargetId);
            const highlighted = Boolean(sourceProps["data-readme-highlighted"]);
            if (!image.src) {
                return (
                    <span
                        className={readmeHiddenMediaClass(image.kind, highlighted)}
                        data-readme-media-kind={image.kind}
                        data-readme-media-blocked={image.blockedReason ?? "invalid"}
                        title={image.blockedReason === "external" ? "External image hidden by README settings." : "README image could not be resolved."}
                        {...sourceProps}
                    >
                        {image.blockedReason === "external" ? "Image hidden" : "Image unavailable"}
                    </span>
                );
            }
            return (
                <img
                    src={image.src}
                    alt={alt || ""}
                    title={typeof title === "string" ? title : undefined}
                    width={image.width ?? undefined}
                    height={image.height ?? undefined}
                    loading={image.kind === "badge" || image.kind === "icon" || image.kind === "logo" ? "eager" : "lazy"}
                    decoding="async"
                    referrerPolicy={image.trustedExternal || !allowExternalImages ? "no-referrer" : undefined}
                    onLoad={onMediaLoad}
                    style={readmeMediaStyle(image)}
                    data-readme-media-kind={image.kind}
                    data-readme-media-original-src={image.originalSrc || undefined}
                    className={readmeMediaClass(image.kind, highlighted)}
                    {...sourceProps}
                />
            );
        },
        table: ({ node, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("table", node, highlightedTargetId);
            return (
                <div className={cn("my-5 overflow-x-auto rounded-md transition-[background-color,box-shadow]", sourceHighlightClass(Boolean(sourceProps["data-readme-highlighted"])))} {...sourceProps}>
                    <table className="min-w-full table-fixed border-collapse text-left text-sm" {...props} />
                </div>
            );
        },
        th: ({ ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className="border border-zinc-200 bg-zinc-50 px-4 py-3 align-top font-semibold dark:border-zinc-700 dark:bg-zinc-900" {...props} />,
        td: ({ ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
            <td
                className="border border-zinc-200 px-5 py-5 align-top text-zinc-700 dark:border-zinc-700 dark:text-zinc-300 [&>p:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_img[data-readme-media-kind='badge']]:my-0 [&_img[data-readme-media-kind='icon']]:my-0"
                {...props}
            />
        ),
        hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => <hr className="my-8 border-zinc-200 dark:border-zinc-800" {...props} />,
    };

    const renderMarkdownWithInlineReferences = (content: string, segmentKey: string) => (
        <MemoizedMarkdownSegment
            key={segmentKey}
            content={content}
            components={components}
            renderSignature={markdownRenderSignature}
        />
    );

    const handleEditorSourceClickCapture = (event: React.MouseEvent<HTMLElement>) => {
        if (!onRequestSourcePosition) return;
        const clicked = event.target instanceof HTMLElement ? event.target : null;
        if (clicked?.closest("[data-readme-copy-button='true']")) return;
        const sourceElement = clicked?.closest<HTMLElement>("[data-readme-source-line],[data-readme-source-offset]");
        if (!sourceElement || !event.currentTarget.contains(sourceElement)) return;
        event.preventDefault();
        const line = Number(sourceElement.dataset.readmeSourceLine);
        const offset = Number(sourceElement.dataset.readmeSourceOffset);
        onRequestSourcePosition({
            targetId: sourceElement.dataset.readmeEditorTargetId
                || sourceElement.dataset.readmeTargetId
                || sourceElement.id,
            kind: sourceElement.dataset.readmeSourceKind ?? null,
            line: Number.isFinite(line) ? line : null,
            offset: Number.isFinite(offset) ? offset : null,
        });
    };

    return (
        <article
            className={cn("readme-body min-w-0 text-zinc-950 dark:text-zinc-50", className)}
            data-readme-preview-fidelity={fidelity}
            data-readme-editor-source-targets={onRequestSourcePosition ? "true" : undefined}
            onClickCapture={handleEditorSourceClickCapture}
        >
            <Suspense fallback={<div className="text-sm text-zinc-500">Rendering README…</div>}>
                {segments.map((segment, index) => {
                    if (segment.kind === "block") {
                        const previewKey = `${segment.block.kind}:${segment.block.ids.join(",")}:${segment.block.index}`;
                        const stablePreviewKey = `${segment.block.kind}:${segment.block.ids.join(",")}`;
                        const preview = effectivePreviewByKey.get(previewKey) ?? effectivePreviewByKey.get(stablePreviewKey) ?? null;
                        return allowSmartBlocks
                            ? (
                                <ProjectReadmeSmartBlock
                                    key={`block-${index}`}
                                    block={segment.block}
                                    project={project}
                                    editorMode={editorMode}
                                    preview={preview}
                                    loading={effectivePreviewsLoading}
                                />
                            )
                            : null;
                    }
                    const referenceLinks = extractReferenceLinks(segment.content);
                    const subSections = splitMarkdownIntoSections(segment.content);

                    return (
                        <React.Fragment key={`segment-group-${index}`}>
                            {subSections.map((section, secIdx) => {
                                const sectionContent = referenceLinks ? `${section}\n\n${referenceLinks}` : section;
                                const secKey = `sec-${index}-${secIdx}`;
                                return renderMarkdownWithInlineReferences(sectionContent, secKey);
                            })}
                        </React.Fragment>
                    );
                })}
            </Suspense>
        </article>
    );
});
