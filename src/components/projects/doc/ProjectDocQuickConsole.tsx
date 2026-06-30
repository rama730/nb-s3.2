"use client";

import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardList, Copy, ExternalLink, FileText, Hash, Link2, SquareTerminal, ChevronDown, Plus, X, Search, Loader2, Pencil } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
    normalizeReadmeReferenceLabel,
    type ProjectDocInlineReference,
    type ProjectDocReferenceOption,
    type ProjectDocSmartBlockPreview,
} from "@/lib/projects/doc-blocks";
import { normalizeProjectDocSlug, type ProjectDocHeading } from "@/lib/projects/doc";
import {
    PROJECT_DOC_PRIMARY_COMMAND_GROUPS,
    type ProjectDocCommandGroup,
    type ProjectDocQuickCommand,
    type ProjectDocRailReport,
} from "@/lib/projects/doc-quick-console";
import type { ProjectDocRailAction, ProjectDocRailTabId } from "@/lib/projects/doc-view-model";
import { buildProjectDocPlainText } from "@/lib/projects/doc-plain-text";
import { cn } from "@/lib/utils";
import {
    useProjectMarkdowns,
    PROJECT_MARKDOWNS_LIST_QUERY_KEY,
    PROJECT_DOC_DRAFT_QUERY_KEY,
    PROJECT_DOC_QUERY_KEY,
} from "@/hooks/hub/useProjectDocData";
import { createProjectMarkdownAction, readProjectMarkdownSearchAction } from "@/app/actions/project";
import { ProjectDocLinkDialog } from "@/components/projects/doc/ProjectDocLinkDialog";


type ReadmeRailVariant = "rail" | "compact";

const COMMAND_GROUP_ORDER: ProjectDocCommandGroup[] = [
    "recommended",
    "install",
    "claude",
    "agents",
    "config",
    "options",
    "uninstall",
    "develop",
    "quality",
    "deploy",
    "database",
    "other",
];
const LARGE_RAIL_LIST_THRESHOLD = 80;

function groupCommandsByIntent(commands: ProjectDocQuickCommand[]) {
    const grouped = new Map<ProjectDocCommandGroup, ProjectDocQuickCommand[]>();
    commands.forEach((command) => {
        const list = grouped.get(command.group) ?? [];
        list.push(command);
        grouped.set(command.group, list);
    });
    return Array.from(grouped.entries()).sort((a, b) => {
        const aIndex = COMMAND_GROUP_ORDER.indexOf(a[0]);
        const bIndex = COMMAND_GROUP_ORDER.indexOf(b[0]);
        return (aIndex < 0 ? COMMAND_GROUP_ORDER.length : aIndex) - (bIndex < 0 ? COMMAND_GROUP_ORDER.length : bIndex);
    });
}

function renderReadmeRailTabIcon(id: ProjectDocRailTabId) {
    const className = "h-3.5 w-3.5 shrink-0";
    switch (id) {
        case "brief": return <FileText className={className} />;
        case "commands": return <SquareTerminal className={className} />;
        case "links": return <Link2 className={className} />;
        case "outline": return <Hash className={className} />;
        case "search": return <Search className={className} />;
        default: return <ClipboardList className={className} />;
    }
}

function cleanRailBriefText(value: string | null | undefined, maxLength = 360) {
    return buildProjectDocPlainText(value, { maxLength });
}

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

type ReadmeRailState = {
    openTab: ProjectDocRailTabId | null;
    selectedActionId: string | null;
};

type ReadmeRailAction =
    | { type: "toggle_tab"; id: ProjectDocRailTabId }
    | { type: "close_tab" }
    | { type: "select_action"; actionId: string; closePanel: boolean }
    | { type: "sync_tabs"; availableTabIds: ProjectDocRailTabId[] };

function readmeRailReducer(state: ReadmeRailState, action: ReadmeRailAction): ReadmeRailState {
    switch (action.type) {
        case "toggle_tab":
            return { ...state, openTab: state.openTab === action.id ? null : action.id };
        case "close_tab":
            return { ...state, openTab: null };
        case "select_action":
            return { selectedActionId: action.actionId, openTab: action.closePanel ? null : state.openTab };
        case "sync_tabs":
            return state.openTab && !action.availableTabIds.includes(state.openTab)
                ? { ...state, openTab: null }
                : state;
        default:
            return state;
    }
}

function ReadmeRailTabButton({
    id,
    instanceId,
    label,
    count,
    active,
    onToggle,
}: {
    id: ProjectDocRailTabId;
    instanceId: string;
    label: string;
    count?: number | null;
    active: boolean;
    onToggle: (id: ProjectDocRailTabId) => void;
}) {
    return (
        <button
            type="button"
            id={`readme-rail-${instanceId}-tab-${id}`}
            role="tab"
            data-readme-rail-tab={id}
            aria-selected={active}
            aria-expanded={active}
            aria-controls={`readme-rail-${instanceId}-panel-${id}`}
            onClick={() => onToggle(id)}
            className={cn(
                "relative inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                active
                    ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-500/60 dark:bg-blue-500/10 dark:text-blue-300"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-blue-200 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-blue-500/50 dark:hover:text-blue-300",
            )}
        >
            {renderReadmeRailTabIcon(id)}
            <span className="truncate">{label}</span>
            {typeof count === "number" ? (
                <span
                    className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                        active ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                    )}
                >
                    {count}
                </span>
            ) : null}
        </button>
    );
}

const ReferenceRow = memo(function ReferenceRow({
    action,
    option,
    fallback,
    active,
    highlighted,
    onExecuteAction,
}: {
    action: ProjectDocRailAction;
    option?: ProjectDocReferenceOption | null;
    fallback: ProjectDocInlineReference;
    active: boolean;
    highlighted: boolean;
    onExecuteAction: (action: ProjectDocRailAction) => void;
}) {
    const label = normalizeReadmeReferenceLabel(fallback.kind, option?.title || fallback.label);
    const detail = option?.context || option?.status || option?.kindLabel || option?.subtitle || null;
    const stateLabel = action.previewLoading
        ? "Loading project link"
        : action.previewError
            ? "Could not load this project link"
            : action.openHref || detail
                ? null
                : "Private or missing project link";
    const content = (
        <>
            <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{label}</span>
            {action.previewLoading ? (
                <span className="mt-1 h-3 w-28 max-w-full animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <span className="sr-only">Loading project link</span>
                </span>
            ) : detail || stateLabel ? (
                <span
                    data-readme-preview-state={action.previewError ? "error" : stateLabel ? "unavailable" : "ready"}
                    className={cn(
                        "truncate text-xs",
                        action.previewError ? "text-amber-600 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-500",
                    )}
                >
                    {detail || stateLabel}
                </span>
            ) : null}
        </>
    );

    return (
        <div
            className={cn(
                "group flex min-w-0 items-center gap-1 rounded-xl transition-[background-color,box-shadow]",
                active && "bg-blue-50 dark:bg-blue-500/10",
                highlighted && "shadow-[0_0_0_3px_rgba(59,130,246,0.18)]",
            )}
        >
            <button
                type="button"
                onClick={() => onExecuteAction(action)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:hover:bg-zinc-900"
                aria-current={active ? "location" : undefined}
                title={`Show ${label}`}
            >
                <Link2 className={cn("h-3.5 w-3.5 shrink-0", active ? "text-blue-600 dark:text-blue-300" : "text-zinc-500")} />
                <span className="flex min-w-0 flex-col">{content}</span>
            </button>
            {action.openHref ? (
                <a
                    href={action.openHref}
                    className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:hover:bg-zinc-950 dark:hover:text-blue-300"
                    aria-label={`Open ${label}`}
                    title={`Open ${label}`}
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            ) : null}
        </div>
    );
});

const CommandShortcutRow = memo(function CommandShortcutRow({
    action,
    command,
    active,
    highlighted,
    copied,
    onExecuteAction,
}: {
    action: ProjectDocRailAction;
    command: ProjectDocQuickCommand;
    active: boolean;
    highlighted: boolean;
    copied: boolean;
    onExecuteAction: (action: ProjectDocRailAction) => void;
}) {
    const copyCommand = () => onExecuteAction(action);

    return (
        <div
            className={cn(
                "group flex min-w-0 items-stretch gap-1 rounded-xl border border-zinc-200/70 bg-zinc-50/60 p-1.5 transition-[background-color,border-color,box-shadow] hover:border-blue-300 dark:border-zinc-800 dark:bg-zinc-950/50 dark:hover:border-blue-500/60",
                active && "border-blue-300 bg-blue-50/80 shadow-sm dark:border-blue-500/60 dark:bg-blue-500/10",
                highlighted && "shadow-[0_0_0_3px_rgba(59,130,246,0.22)]",
            )}
        >
            <button
                type="button"
                onClick={copyCommand}
                aria-current={active ? "location" : undefined}
                className="min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500/40"
                title={`Copy and show ${command.label}`}
            >
                <span className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                        className={cn(
                            "min-w-0 break-words text-xs font-semibold text-zinc-700 transition [overflow-wrap:anywhere] dark:text-zinc-300",
                            active && "text-blue-700 dark:text-blue-300",
                        )}
                    >
                        {command.label}
                    </span>
                    {command.detail ? (
                        <span className="max-w-full rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                            {command.detail}
                        </span>
                    ) : null}
                    {command.platforms.map((platform) => (
                        <span
                            key={platform}
                            className="max-w-full rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
                        >
                            {platform}
                        </span>
                    ))}
                    {command.ecosystemTags.map((tag) => (
                        <span
                            key={tag}
                            className="max-w-full rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"
                        >
                            {tag}
                        </span>
                    ))}
                    <span
                        className={cn(
                            "max-w-full rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            command.confidence === "high" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
                            command.confidence === "medium" && "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
                            command.confidence === "low" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
                        )}
                    >
                        {command.confidenceLabel}
                    </span>
                    {command.riskLabel ? (
                        <span
                            className={cn(
                                "max-w-full rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                command.riskLevel === "danger"
                                    ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                                    : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
                            )}
                        >
                            {command.riskLabel}
                        </span>
                    ) : null}
                </span>
                <code
                    aria-current={active ? "location" : undefined}
                    className="block min-w-0 whitespace-pre-wrap break-words rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] leading-5 text-zinc-700 [overflow-wrap:anywhere] dark:bg-black/30 dark:text-zinc-300"
                >
                    {command.command}
                </code>
            </button>
            <button
                type="button"
                onClick={copyCommand}
                className={cn(
                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-blue-300",
                    active && "border-blue-200 text-blue-600 dark:border-blue-500/50 dark:text-blue-300",
                )}
                aria-label={`Copy ${command.label}`}
                title={copied ? "Copied" : "Copy command"}
            >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="sr-only" aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
            </button>
        </div>
    );
});

const HeadingRow = memo(function HeadingRow({
    action,
    heading,
    active,
    highlighted,
    onExecuteAction,
}: {
    action: ProjectDocRailAction;
    heading: ProjectDocHeading;
    active: boolean;
    highlighted: boolean;
    onExecuteAction: (action: ProjectDocRailAction) => void;
}) {
    const showHeading = () => onExecuteAction(action);

    return (
        <a
            href={`#${heading.id}`}
            onClick={(event) => {
                event.preventDefault();
                showHeading();
            }}
            onKeyDown={(event) => {
                if (event.key !== " ") return;
                event.preventDefault();
                showHeading();
            }}
            aria-current={active ? "location" : undefined}
            className={cn(
                "block truncate rounded-lg px-2 py-1 text-sm text-zinc-500 outline-none transition-[background-color,box-shadow,color] hover:bg-zinc-100 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:hover:bg-zinc-900 dark:hover:text-blue-300",
                heading.level > 2 && "pl-4 text-xs",
                heading.level > 3 && "pl-6",
                active && "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
                highlighted && "shadow-[0_0_0_3px_rgba(59,130,246,0.18)]",
            )}
        >
            {heading.text}
        </a>
    );
});

function DocumentSwitcher({ 
    projectId, 
    activeSlug,
    canEdit,
    onEdit,
}: { 
    projectId: string; 
    activeSlug: string;
    canEdit: boolean;
    onEdit?: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
    
    const { data: markdowns = [], isLoading } = useProjectMarkdowns(projectId);

    // Client-side sorting fallback
    const sortedMarkdowns = useMemo(() => {
        return [...markdowns].sort((a, b) => {
            if (a.slug === "readme") return -1;
            if (b.slug === "readme") return 1;
            return a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base', numeric: true });
        });
    }, [markdowns]);

    const handleSelect = (slug: string) => {
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.set("doc", normalizeProjectDocSlug(slug));
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    return (
        <>
            {isLoading ? (
                <div className="flex h-9 items-center justify-center px-3 text-zinc-400 text-xs gap-1.5 shrink-0">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                </div>
            ) : (
                sortedMarkdowns.map((doc) => (
                    <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleSelect(doc.slug)}
                        className={cn(
                            "inline-flex h-9 items-center justify-center rounded-lg border px-2.5 text-xs font-semibold transition-colors truncate shrink-0 select-none",
                            doc.slug === activeSlug
                                ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/60 dark:bg-blue-500/10 dark:text-blue-300"
                                : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-700"
                        )}
                    >
                        <FileText className="h-3.5 w-3.5 shrink-0 mr-1.5 text-zinc-500" />
                        <span className="truncate">{doc.filename}</span>
                    </button>
                ))
            )}
            
            {canEdit && (
                <button
                    type="button"
                    onClick={() => setIsLinkDialogOpen(true)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 hover:bg-zinc-100 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/50 dark:hover:bg-zinc-900 transition-colors shrink-0"
                    title="Add Document..."
                >
                    <Plus className="h-3.5 w-3.5 text-zinc-500" />
                </button>
            )}

            {canEdit && onEdit && (
                <button
                    type="button"
                    onClick={onEdit}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors shrink-0"
                >
                    <Pencil className="h-3.5 w-3.5 text-zinc-500" />
                    <span>Edit</span>
                </button>
            )}

            <ProjectDocLinkDialog
                projectId={projectId}
                isOpen={isLinkDialogOpen}
                onClose={() => setIsLinkDialogOpen(false)}
            />
        </>
    );
}

function SearchPanel({ projectId, onSelectMatch }: { projectId: string; onSelectMatch: (docSlug: string, line: number) => void }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    
    useEffect(() => {
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            return;
        }
        
        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await readProjectMarkdownSearchAction(projectId, trimmed);
                if (res.success) {
                    setResults(res.results);
                } else {
                    toast.error(res.error || "Search failed");
                }
            } catch (err) {
                console.error(err);
            } finally {
                setSearching(false);
            }
        }, 300);
        
        return () => clearTimeout(timer);
    }, [query, projectId]);

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <input
                    type="text"
                    placeholder="Search docs..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-8 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:bg-zinc-900 transition-colors"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-2.5 top-2.5 p-0.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                        <X className="h-3 w-3" />
                    </button>
                )}
            </div>
            
            <div className="space-y-4 max-h-[24rem] overflow-y-auto pr-1 app-scroll app-scroll-y">
                {searching ? (
                    <div className="flex items-center justify-center py-8 text-zinc-400 text-sm gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        Searching documents...
                    </div>
                ) : query && results.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400 text-sm">
                        No matches found for &quot;{query}&quot;
                    </div>
                ) : !query ? (
                    <div className="text-center py-8 text-zinc-400 text-xs">
                        Type a search query to search across all documents.
                    </div>
                ) : (
                    results.map((docResult) => (
                        <div key={docResult.slug} className="space-y-1.5">
                            <div className="flex items-center gap-1.5 px-1">
                                <FileText className="h-3.5 w-3.5 text-zinc-400" />
                                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{docResult.filename}</span>
                            </div>
                            <div className="space-y-1">
                                {docResult.matches.map((match: any) => (
                                    <button
                                        key={match.line}
                                        type="button"
                                        onClick={() => onSelectMatch(docResult.slug, match.line)}
                                        className="flex w-full flex-col gap-0.5 rounded-lg border border-zinc-100 bg-zinc-50/50 p-2 text-left hover:border-blue-200 hover:bg-blue-50/30 dark:border-zinc-800/60 dark:bg-zinc-900/30 dark:hover:border-blue-500/50 dark:hover:bg-blue-950/20 transition-all group"
                                    >
                                        <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
                                            <span>Line {match.line}</span>
                                            <span className="opacity-0 group-hover:opacity-100 text-blue-600 dark:text-blue-400 font-semibold transition-opacity">Jump to line &rarr;</span>
                                        </div>
                                        <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                                            {match.text}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export function ProjectDocQuickConsole({
    projectId,
    docSlug = "readme",
    excerpt,
    headings,
    commands,
    references,
    report,
    railActions,
    recommendedAction,
    highlightedTargetId,
    highlightedTargetToken,
    instanceId,
    onRailAction,
    onOpenTabChange,
    onSelectedActionChange,
    openTab,
    railTabs,
    referencePreviewByKey,
    referencesError = false,
    referencesLoading = false,
    selectedActionId,
    variant = "rail",
    className,
    canEdit = false,
    onEdit,
}: {
    projectId: string;
    docSlug?: string;
    excerpt?: string | null;
    headings: ProjectDocHeading[];
    commands: ProjectDocQuickCommand[];
    references: ProjectDocInlineReference[];
    report?: ProjectDocRailReport | null;
    railActions: ProjectDocRailAction[];
    recommendedAction?: ProjectDocRailAction | null;
    highlightedTargetId?: string | null;
    highlightedTargetToken?: number | null;
    instanceId?: string;
    onRailAction?: (action: ProjectDocRailAction) => void;
    onOpenTabChange?: (openTab: ProjectDocRailTabId | null) => void;
    onSelectedActionChange?: (selectedActionId: string | null) => void;
    openTab?: ProjectDocRailTabId | null;
    railTabs?: ProjectDocRailTabId[];
    referencePreviewByKey?: Map<string, ProjectDocSmartBlockPreview>;
    referencesError?: boolean;
    referencesLoading?: boolean;
    selectedActionId?: string | null;
    variant?: ReadmeRailVariant;
    className?: string;
    canEdit?: boolean;
    onEdit?: () => void;
}) {
    const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const railInstanceId = instanceId ?? generatedId;
    const reportSignals = report?.signals ?? [];
    const cleanExcerpt = cleanRailBriefText(excerpt);
    const cleanSummary = cleanRailBriefText(report?.summary);
    const briefItems = report?.briefItems ?? [];
    const primaryCommands = useMemo(() => commands.filter((command) => PROJECT_DOC_PRIMARY_COMMAND_GROUPS.has(command.group)), [commands]);
    const configCommands = useMemo(() => commands.filter((command) => command.group === "config"), [commands]);
    const optionCommands = useMemo(() => commands.filter((command) => command.group === "options"), [commands]);
    const commandGroups = useMemo(() => groupCommandsByIntent(primaryCommands), [primaryCommands]);
    const configCommandGroups = useMemo(() => groupCommandsByIntent(configCommands), [configCommands]);
    const optionCommandGroups = useMemo(() => groupCommandsByIntent(optionCommands), [optionCommands]);
    const actionByCommandId = useMemo(() => {
        const map = new Map<string, ProjectDocRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "command" && action.command) map.set(action.command.id, action);
        });
        return map;
    }, [railActions]);
    const actionByReferenceKey = useMemo(() => {
        const map = new Map<string, ProjectDocRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "reference" && action.referencePreviewKey) map.set(action.referencePreviewKey, action);
        });
        return map;
    }, [railActions]);
    const actionByHeadingId = useMemo(() => {
        const map = new Map<string, ProjectDocRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "heading" && action.heading) map.set(action.heading.id, action);
        });
        return map;
    }, [railActions]);
    const briefStartAction = recommendedAction?.kind === "command" && recommendedAction.command ? recommendedAction : null;
    const briefFactItems = briefItems.filter((item) => item.label.toLowerCase() !== "start here");
    const briefAvailable = Boolean(
        cleanExcerpt
        || cleanSummary
        || briefItems.length
        || reportSignals.length
        || report?.summaryItems.length
        || report?.nextAction
        || report?.limitations.length
        || briefStartAction,
    );
    const hasInstallCommands = primaryCommands.some((command) => (
        command.group === "install"
        || command.group === "recommended"
        || command.group === "claude"
        || command.group === "agents"
    ));
    const commandTabLabel = hasInstallCommands ? "Install" : "Commands";
    const tabListRef = useRef<HTMLDivElement | null>(null);
    const copiedTimerRef = useRef<number | null>(null);
    const [copiedActionId, setCopiedActionId] = useState<string | null>(null);
    const [railAnnouncement, setRailAnnouncement] = useState("");
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const handleSelectMatch = useCallback((matchSlug: string, line: number) => {
        const normalizedMatchSlug = normalizeProjectDocSlug(matchSlug);
        const normalizedActiveSlug = normalizeProjectDocSlug(docSlug);
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.set("doc", normalizedMatchSlug);
        
        if (normalizedMatchSlug === normalizedActiveSlug) {
            const targetId = `line-${line}`;
            onRailAction?.({
                id: `search-jump-${line}`,
                kind: "heading",
                railTab: "search",
                label: `Line ${line}`,
                description: null,
                targetId,
                copyText: null,
                openHref: null,
                sourceIndex: 0,
                platforms: [],
            });
        } else {
            router.replace(`${pathname}?${params.toString()}#line-${line}`, { scroll: false });
        }
    }, [docSlug, pathname, searchParams, router, onRailAction]);

    const [localRailState, dispatchRail] = useReducer(readmeRailReducer, { openTab: null, selectedActionId: null });
    const railState = {
        openTab: openTab !== undefined ? openTab : localRailState.openTab,
        selectedActionId: selectedActionId !== undefined ? selectedActionId : localRailState.selectedActionId,
    };
    const availableTabIds = useMemo(() => {
        if (railTabs?.length) return railTabs;
        const ids: ProjectDocRailTabId[] = [];
        if (briefAvailable) ids.push("brief");
        if (primaryCommands.length) ids.push("commands");
        if (references.length) ids.push("links");
        if (headings.length) ids.push("outline");
        if (configCommands.length) ids.push("config");
        if (optionCommands.length) ids.push("options");
        ids.push("search");
        return ids;
    }, [briefAvailable, configCommands.length, headings.length, optionCommands.length, primaryCommands.length, railTabs, references.length]);
    const hasContent = availableTabIds.length > 0;
    useEffect(() => {
        if (railState.openTab && !availableTabIds.includes(railState.openTab)) {
            onOpenTabChange?.(null);
            dispatchRail({ type: "close_tab" });
        } else {
            dispatchRail({ type: "sync_tabs", availableTabIds });
        }
    }, [availableTabIds, onOpenTabChange, railState.openTab]);

    useEffect(() => () => {
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    }, []);

    const executeRailAction = useCallback((action: ProjectDocRailAction) => {
        const nextOpenTab = variant === "compact" ? null : railState.openTab;
        onSelectedActionChange?.(action.id);
        onOpenTabChange?.(nextOpenTab);
        dispatchRail({ type: "select_action", actionId: action.id, closePanel: variant === "compact" });
        onRailAction?.(action);

        if (!action.copyText) {
            setRailAnnouncement(`Moved to ${action.label}`);
            return;
        }
        setRailAnnouncement(`Copying ${action.label} and moving to document target`);
        void copyTextWithFallback(action.copyText)
            .then(() => {
                setCopiedActionId(action.id);
                setRailAnnouncement(`Copied ${action.label} and moved to document target`);
                if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
                copiedTimerRef.current = window.setTimeout(() => {
                    setCopiedActionId((current) => current === action.id ? null : current);
                }, 1400);
            })
            .catch((error) => {
                console.error("[ProjectDocQuickConsole] Copy command failed", error);
                setRailAnnouncement(`Could not copy ${action.label}, but moved to document target`);
            });
    }, [onOpenTabChange, onRailAction, onSelectedActionChange, railState.openTab, variant]);

    if (!hasContent) return null;

    const handleTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            onOpenTabChange?.(null);
            dispatchRail({ type: "close_tab" });
            return;
        }
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const buttons = Array.from(tabListRef.current?.querySelectorAll<HTMLButtonElement>("[data-readme-rail-tab]") ?? []);
        if (!buttons.length) return;
        const currentIndex = Math.max(0, buttons.findIndex((button) => button === document.activeElement));
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? buttons.length - 1
                : event.key === "ArrowRight"
                    ? (currentIndex + 1) % buttons.length
                    : (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
    };

    const toggleRailTab = (id: ProjectDocRailTabId) => {
        const nextOpenTab = railState.openTab === id ? null : id;
        onOpenTabChange?.(nextOpenTab);
        dispatchRail({ type: "toggle_tab", id });
    };

    const renderCommandGroups = (groups: Array<[ProjectDocCommandGroup, ProjectDocQuickCommand[]]>) => (
        <div className="space-y-3">
            {groups.map(([group, groupCommands]) => (
                <div key={group} className="space-y-1.5">
                    {groups.length > 1 ? (
                        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                            {groupCommands[0]?.groupLabel}
                        </p>
                    ) : null}
                    {groupCommands.map((command) => {
                        const action = actionByCommandId.get(command.id);
                        if (!action) return null;
                        return (
                            <CommandShortcutRow
                                key={action.id}
                                action={action}
                                active={railState.selectedActionId === action.id}
                                command={command}
                                copied={copiedActionId === action.id}
                                highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                                onExecuteAction={executeRailAction}
                            />
                        );
                    })}
                </div>
            ))}
        </div>
    );

    const renderCommandRow = (command: ProjectDocQuickCommand) => {
        const action = actionByCommandId.get(command.id);
        if (!action) return null;
        return (
            <CommandShortcutRow
                key={action.id}
                action={action}
                active={railState.selectedActionId === action.id}
                command={command}
                copied={copiedActionId === action.id}
                highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                onExecuteAction={executeRailAction}
            />
        );
    };

    const renderCommandList = (list: ProjectDocQuickCommand[], groups: Array<[ProjectDocCommandGroup, ProjectDocQuickCommand[]]>) => {
        if (list.length <= LARGE_RAIL_LIST_THRESHOLD) return renderCommandGroups(groups);
        return (
            <div className="h-[28rem] min-h-0">
                <Virtuoso
                    data={list}
                    itemContent={(_, command) => (
                        <div className="pb-2 pr-1">
                            {renderCommandRow(command)}
                        </div>
                    )}
                />
            </div>
        );
    };

    const renderBriefPanel = () => (
        <div className="space-y-5">
            {briefFactItems.length || cleanExcerpt || briefStartAction?.command ? (
                <section>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                        <FileText className="h-3.5 w-3.5" />
                        Doc Brief
                    </div>
                    {briefFactItems.length ? (
                        <dl className="grid gap-2.5">
                            {briefFactItems.map((item, index) => (
                                <div key={`${item.label}:${index}`} className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50/60 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950/50">
                                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{item.label}</dt>
                                    <dd className="break-words text-xs leading-5 text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : cleanExcerpt ? (
                        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{cleanExcerpt}</p>
                    ) : null}
                    {briefStartAction?.command ? (
                        <div className={cn("space-y-1.5", (briefFactItems.length || cleanExcerpt) && "mt-3")}>
                            <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                                Start here
                            </p>
                            <CommandShortcutRow
                                action={briefStartAction}
                                active={railState.selectedActionId === briefStartAction.id}
                                command={briefStartAction.command}
                                copied={copiedActionId === briefStartAction.id}
                                highlighted={highlightedTargetId === briefStartAction.targetId && railState.selectedActionId === briefStartAction.id}
                                onExecuteAction={executeRailAction}
                            />
                        </div>
                    ) : null}
                </section>
            ) : null}

            {cleanSummary || reportSignals.length || report?.summaryItems.length || report?.warnings.length || report?.limitations.length ? (
                <section>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                        <ClipboardList className="h-3.5 w-3.5" />
                        Doc Report
                    </div>
                    {cleanSummary && !briefItems.some((item) => item.value === cleanSummary) ? (
                        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{cleanSummary}</p>
                    ) : null}
                    {report?.summaryItems.length ? (
                        <dl className="mt-3 grid gap-2">
                            {report.summaryItems.map((item) => (
                                <div key={`${item.label}:${item.value}`} className="min-w-0">
                                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{item.label}</dt>
                                    <dd className="break-words text-xs leading-5 text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : null}
                    {report?.warnings.length ? (
                        <div className="mt-3 space-y-1">
                            {report.warnings.map((warning, index) => (
                                <p key={`${warning}-${index}`} className="rounded-lg bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                                    {warning}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    {report?.limitations.length ? (
                        <div className="mt-3 space-y-1">
                            {report.limitations.map((limitation, index) => (
                                <p key={`${limitation}-${index}`} className="rounded-lg bg-zinc-100 px-2 py-1 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                                    {limitation}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    {report?.platforms.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {report.platforms.map((platform) => (
                                <span
                                    key={platform}
                                    className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                                >
                                    {platform}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {reportSignals.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {reportSignals.map((signal) => (
                                <span
                                    key={signal}
                                    className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                                >
                                    {signal}
                                </span>
                            ))}
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    );

    const renderLinksPanel = () => (
        <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                <Link2 className="h-3.5 w-3.5" />
                Project Links
            </div>
            <div className="space-y-1">
                {references.map((reference, index) => {
                    const key = `${reference.kind}:${reference.id}:${index}`;
                    const action = actionByReferenceKey.get(key);
                    if (!action) return null;
                    const previewOption = action.previewOption ?? referencePreviewByKey?.get(key)?.items[0] ?? null;
                    const referenceAction = {
                        ...action,
                        openHref: action.openHref ?? previewOption?.href ?? null,
                        previewLoading: action.previewLoading ?? referencesLoading,
                        previewError: action.previewError ?? referencesError,
                    };
                    return (
                        <ReferenceRow
                            key={referenceAction.id}
                            action={referenceAction}
                            active={railState.selectedActionId === referenceAction.id}
                            fallback={reference}
                            highlighted={highlightedTargetId === referenceAction.targetId && railState.selectedActionId === referenceAction.id}
                            onExecuteAction={executeRailAction}
                            option={previewOption}
                        />
                    );
                })}
            </div>
        </section>
    );

    const renderOutlinePanel = () => (
        <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                <Hash className="h-3.5 w-3.5" />
                On This Document
            </div>
            <nav className="space-y-1" aria-label="Document sections">
                {headings.length > LARGE_RAIL_LIST_THRESHOLD ? (
                    <div className="h-[28rem] min-h-0">
                        <Virtuoso
                            data={headings}
                            itemContent={(_, heading) => {
                                const action = actionByHeadingId.get(heading.id);
                                if (!action) return null;
                                return (
                                    <div className="pb-1 pr-1">
                                        <HeadingRow
                                            action={action}
                                            active={railState.selectedActionId === action.id}
                                            heading={heading}
                                            highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                                            onExecuteAction={executeRailAction}
                                        />
                                    </div>
                                );
                            }}
                        />
                    </div>
                ) : headings.map((heading) => {
                    const action = actionByHeadingId.get(heading.id);
                    if (!action) return null;
                    return (
                        <HeadingRow
                            key={action.id}
                            action={action}
                            active={railState.selectedActionId === action.id}
                            heading={heading}
                            highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                            onExecuteAction={executeRailAction}
                        />
                    );
                })}
            </nav>
        </section>
    );

    const baseTabs = [
        briefAvailable
            ? {
                id: "brief" as const,
                label: "Brief",
                count: report?.signals.length || null,
                content: renderBriefPanel,
            }
            : null,
        primaryCommands.length
            ? {
                id: "commands" as const,
                label: commandTabLabel,
                count: primaryCommands.length,
                content: () => (
                    <section>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                            <SquareTerminal className="h-3.5 w-3.5" />
                            Quick Commands
                        </div>
                        {renderCommandList(primaryCommands, commandGroups)}
                    </section>
                ),
            }
            : null,
        references.length
            ? {
                id: "links" as const,
                label: "Links",
                count: references.length,
                content: renderLinksPanel,
            }
            : null,
        headings.length
            ? {
                id: "outline" as const,
                label: "Outline",
                count: headings.length,
                content: renderOutlinePanel,
            }
            : null,
        configCommands.length
            ? {
                id: "config" as const,
                label: "Config",
                count: configCommands.length,
                content: () => (
                    <section>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                            <ClipboardList className="h-3.5 w-3.5" />
                            Config
                        </div>
                        {renderCommandList(configCommands, configCommandGroups)}
                    </section>
                ),
            }
            : null,
        optionCommands.length
            ? {
                id: "options" as const,
                label: "Options",
                count: optionCommands.length,
                content: () => (
                    <section>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                            <ClipboardList className="h-3.5 w-3.5" />
                            Options
                        </div>
                        {renderCommandList(optionCommands, optionCommandGroups)}
                    </section>
                ),
            }
            : null,
        {
            id: "search" as const,
            label: "Search",
            count: null,
            content: () => (
                <section>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-blue-500">
                        <Search className="h-3.5 w-3.5" />
                        Search Documents
                    </div>
                    <SearchPanel projectId={projectId} onSelectMatch={handleSelectMatch} />
                </section>
            ),
        },
    ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
    const tabOrder = new Map(availableTabIds.map((id, index) => [id, index]));
    const tabs = baseTabs
        .filter((tab) => availableTabIds.includes(tab.id))
        .sort((a, b) => (tabOrder.get(a.id) ?? 999) - (tabOrder.get(b.id) ?? 999));
    const activeTab = tabs.find((tab) => tab.id === railState.openTab) ?? null;

    return (
        <aside
            aria-label="Document tools"
            className={cn(
                variant === "compact"
                    ? "sticky top-20 z-20 flex max-h-[min(70dvh,calc(100dvh-var(--ui-topnav-height)-6rem))] min-h-0 flex-col space-y-3 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
                    : "flex h-[calc(100dvh-var(--ui-topnav-height)-4.5rem)] max-h-[calc(100dvh-var(--ui-topnav-height)-4.5rem)] min-h-0 flex-col space-y-3 border-l border-zinc-200 pl-6 dark:border-zinc-800",
                className,
            )}
            data-readme-highlight-token={highlightedTargetToken ?? undefined}
            data-readme-rail-variant={variant}
        >
            <span className="sr-only" aria-live="polite">{railAnnouncement}</span>
            <div className="flex flex-wrap items-center gap-2 shrink-0 w-full mb-3">
                <DocumentSwitcher 
                    projectId={projectId} 
                    activeSlug={docSlug} 
                    canEdit={canEdit}
                    onEdit={onEdit}
                />
            </div>
            <motion.div
                ref={tabListRef}
                className={cn("grid shrink-0 gap-2", variant === "compact" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}
                aria-label="Document rail buttons"
                role="tablist"
                onKeyDown={handleTabListKeyDown}
            >
                {tabs.map((tab) => (
                    <ReadmeRailTabButton
                        key={tab.id}
                        active={railState.openTab === tab.id}
                        count={tab.count}
                        id={tab.id}
                        instanceId={railInstanceId}
                        label={tab.label}
                        onToggle={toggleRailTab}
                    />
                ))}
            </motion.div>
            <AnimatePresence initial={false} mode="wait">
                {activeTab ? (
                    <motion.div
                        key={activeTab.id}
                        id={`readme-rail-${railInstanceId}-panel-${activeTab.id}`}
                        role="tabpanel"
                        aria-labelledby={`readme-rail-${railInstanceId}-tab-${activeTab.id}`}
                        initial={variant === "compact" ? { height: 0, opacity: 0 } : { opacity: 0 }}
                        animate={variant === "compact" ? { height: "auto", opacity: 1 } : { opacity: 1 }}
                        exit={variant === "compact" ? { height: 0, opacity: 0 } : { opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="min-h-0 flex-1 overflow-hidden border-t border-zinc-200 dark:border-zinc-800"
                        data-readme-compact-panel={variant === "compact" ? "true" : undefined}
                    >
                        <div
                            className={cn(
                                "space-y-5 pt-3",
                                variant === "rail" && "h-full min-h-0 overflow-y-auto overscroll-contain pb-10 pr-1 app-scroll app-scroll-y app-scroll-gutter",
                                variant === "compact" && "max-h-[min(70dvh,28rem)] overflow-y-auto overscroll-contain pb-10 pr-1 app-scroll app-scroll-y app-scroll-gutter",
                            )}
                        >
                            {activeTab.content()}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </aside>
    );
}
