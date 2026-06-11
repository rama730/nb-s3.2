"use client";

import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardList, Copy, ExternalLink, FileText, Hash, Link2, SquareTerminal } from "lucide-react";
import { Virtuoso } from "react-virtuoso";

import {
    normalizeReadmeReferenceLabel,
    type ProjectReadmeInlineReference,
    type ProjectReadmeReferenceOption,
    type ProjectReadmeSmartBlockPreview,
} from "@/lib/projects/readme-blocks";
import type { ProjectReadmeHeading } from "@/lib/projects/readme";
import {
    PROJECT_README_PRIMARY_COMMAND_GROUPS,
    type ProjectReadmeCommandGroup,
    type ProjectReadmeQuickCommand,
    type ProjectReadmeRailReport,
} from "@/lib/projects/readme-quick-console";
import type { ProjectReadmeRailAction, ProjectReadmeRailTabId } from "@/lib/projects/readme-view-model";
import { buildProjectReadmePlainText } from "@/lib/projects/readme-plain-text";
import { cn } from "@/lib/utils";

type ReadmeRailVariant = "rail" | "compact";

const COMMAND_GROUP_ORDER: ProjectReadmeCommandGroup[] = [
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

function groupCommandsByIntent(commands: ProjectReadmeQuickCommand[]) {
    const grouped = new Map<ProjectReadmeCommandGroup, ProjectReadmeQuickCommand[]>();
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

function renderReadmeRailTabIcon(id: ProjectReadmeRailTabId) {
    const className = "h-3.5 w-3.5 shrink-0";
    switch (id) {
        case "brief": return <FileText className={className} />;
        case "commands": return <SquareTerminal className={className} />;
        case "links": return <Link2 className={className} />;
        case "outline": return <Hash className={className} />;
        default: return <ClipboardList className={className} />;
    }
}

function cleanRailBriefText(value: string | null | undefined, maxLength = 360) {
    return buildProjectReadmePlainText(value, { maxLength });
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
    openTab: ProjectReadmeRailTabId | null;
    selectedActionId: string | null;
};

type ReadmeRailAction =
    | { type: "toggle_tab"; id: ProjectReadmeRailTabId }
    | { type: "close_tab" }
    | { type: "select_action"; actionId: string; closePanel: boolean }
    | { type: "sync_tabs"; availableTabIds: ProjectReadmeRailTabId[] };

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
    id: ProjectReadmeRailTabId;
    instanceId: string;
    label: string;
    count?: number | null;
    active: boolean;
    onToggle: (id: ProjectReadmeRailTabId) => void;
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
    action: ProjectReadmeRailAction;
    option?: ProjectReadmeReferenceOption | null;
    fallback: ProjectReadmeInlineReference;
    active: boolean;
    highlighted: boolean;
    onExecuteAction: (action: ProjectReadmeRailAction) => void;
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
    action: ProjectReadmeRailAction;
    command: ProjectReadmeQuickCommand;
    active: boolean;
    highlighted: boolean;
    copied: boolean;
    onExecuteAction: (action: ProjectReadmeRailAction) => void;
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
    action: ProjectReadmeRailAction;
    heading: ProjectReadmeHeading;
    active: boolean;
    highlighted: boolean;
    onExecuteAction: (action: ProjectReadmeRailAction) => void;
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

export function ProjectReadmeQuickConsole({
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
}: {
    excerpt?: string | null;
    headings: ProjectReadmeHeading[];
    commands: ProjectReadmeQuickCommand[];
    references: ProjectReadmeInlineReference[];
    report?: ProjectReadmeRailReport | null;
    railActions: ProjectReadmeRailAction[];
    recommendedAction?: ProjectReadmeRailAction | null;
    highlightedTargetId?: string | null;
    highlightedTargetToken?: number | null;
    instanceId?: string;
    onRailAction?: (action: ProjectReadmeRailAction) => void;
    onOpenTabChange?: (openTab: ProjectReadmeRailTabId | null) => void;
    onSelectedActionChange?: (selectedActionId: string | null) => void;
    openTab?: ProjectReadmeRailTabId | null;
    railTabs?: ProjectReadmeRailTabId[];
    referencePreviewByKey?: Map<string, ProjectReadmeSmartBlockPreview>;
    referencesError?: boolean;
    referencesLoading?: boolean;
    selectedActionId?: string | null;
    variant?: ReadmeRailVariant;
    className?: string;
}) {
    const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const railInstanceId = instanceId ?? generatedId;
    const reportSignals = report?.signals ?? [];
    const cleanExcerpt = cleanRailBriefText(excerpt);
    const cleanSummary = cleanRailBriefText(report?.summary);
    const briefItems = report?.briefItems ?? [];
    const primaryCommands = useMemo(() => commands.filter((command) => PROJECT_README_PRIMARY_COMMAND_GROUPS.has(command.group)), [commands]);
    const configCommands = useMemo(() => commands.filter((command) => command.group === "config"), [commands]);
    const optionCommands = useMemo(() => commands.filter((command) => command.group === "options"), [commands]);
    const commandGroups = useMemo(() => groupCommandsByIntent(primaryCommands), [primaryCommands]);
    const configCommandGroups = useMemo(() => groupCommandsByIntent(configCommands), [configCommands]);
    const optionCommandGroups = useMemo(() => groupCommandsByIntent(optionCommands), [optionCommands]);
    const actionByCommandId = useMemo(() => {
        const map = new Map<string, ProjectReadmeRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "command" && action.command) map.set(action.command.id, action);
        });
        return map;
    }, [railActions]);
    const actionByReferenceKey = useMemo(() => {
        const map = new Map<string, ProjectReadmeRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "reference" && action.referencePreviewKey) map.set(action.referencePreviewKey, action);
        });
        return map;
    }, [railActions]);
    const actionByHeadingId = useMemo(() => {
        const map = new Map<string, ProjectReadmeRailAction>();
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
    const [localRailState, dispatchRail] = useReducer(readmeRailReducer, { openTab: null, selectedActionId: null });
    const railState = {
        openTab: openTab !== undefined ? openTab : localRailState.openTab,
        selectedActionId: selectedActionId !== undefined ? selectedActionId : localRailState.selectedActionId,
    };
    const availableTabIds = useMemo(() => {
        if (railTabs?.length) return railTabs;
        const ids: ProjectReadmeRailTabId[] = [];
        if (briefAvailable) ids.push("brief");
        if (primaryCommands.length) ids.push("commands");
        if (references.length) ids.push("links");
        if (headings.length) ids.push("outline");
        if (configCommands.length) ids.push("config");
        if (optionCommands.length) ids.push("options");
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

    const executeRailAction = useCallback((action: ProjectReadmeRailAction) => {
        const nextOpenTab = variant === "compact" ? null : railState.openTab;
        onSelectedActionChange?.(action.id);
        onOpenTabChange?.(nextOpenTab);
        dispatchRail({ type: "select_action", actionId: action.id, closePanel: variant === "compact" });
        onRailAction?.(action);

        if (!action.copyText) {
            setRailAnnouncement(`Moved to ${action.label}`);
            return;
        }
        setRailAnnouncement(`Copying ${action.label} and moving to README target`);
        void copyTextWithFallback(action.copyText)
            .then(() => {
                setCopiedActionId(action.id);
                setRailAnnouncement(`Copied ${action.label} and moved to README target`);
                if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
                copiedTimerRef.current = window.setTimeout(() => {
                    setCopiedActionId((current) => current === action.id ? null : current);
                }, 1400);
            })
            .catch((error) => {
                console.error("[ProjectReadmeQuickConsole] Copy command failed", error);
                setRailAnnouncement(`Could not copy ${action.label}, but moved to README target`);
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

    const toggleRailTab = (id: ProjectReadmeRailTabId) => {
        const nextOpenTab = railState.openTab === id ? null : id;
        onOpenTabChange?.(nextOpenTab);
        dispatchRail({ type: "toggle_tab", id });
    };

    const renderCommandGroups = (groups: Array<[ProjectReadmeCommandGroup, ProjectReadmeQuickCommand[]]>) => (
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

    const renderCommandRow = (command: ProjectReadmeQuickCommand) => {
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

    const renderCommandList = (list: ProjectReadmeQuickCommand[], groups: Array<[ProjectReadmeCommandGroup, ProjectReadmeQuickCommand[]]>) => {
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
                        README Brief
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
                        README Report
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
                On This README
            </div>
            <nav className="space-y-1" aria-label="README sections">
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
    ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
    const tabOrder = new Map(availableTabIds.map((id, index) => [id, index]));
    const tabs = baseTabs
        .filter((tab) => availableTabIds.includes(tab.id))
        .sort((a, b) => (tabOrder.get(a.id) ?? 999) - (tabOrder.get(b.id) ?? 999));
    const activeTab = tabs.find((tab) => tab.id === railState.openTab) ?? null;

    return (
        <aside
            aria-label="README tools"
            className={cn(
                variant === "compact"
                    ? "sticky top-20 z-20 flex max-h-[min(70dvh,calc(100dvh-var(--ui-topnav-height)-6rem))] min-h-0 flex-col space-y-3 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
                    : "flex h-[calc(100dvh-var(--ui-topnav-height)-7rem)] max-h-[calc(100dvh-var(--ui-topnav-height)-7rem)] min-h-0 flex-col space-y-3 border-l border-zinc-200 pl-6 dark:border-zinc-800",
                className,
            )}
            data-readme-highlight-token={highlightedTargetToken ?? undefined}
            data-readme-rail-variant={variant}
        >
            <span className="sr-only" aria-live="polite">{railAnnouncement}</span>
            <motion.div
                ref={tabListRef}
                className={cn("grid shrink-0 gap-2", variant === "compact" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}
                aria-label="README rail buttons"
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
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="min-h-0 flex-1 overflow-hidden border-t border-zinc-200 dark:border-zinc-800"
                        data-readme-compact-panel={variant === "compact" ? "true" : undefined}
                    >
                        <div
                            className={cn(
                                "space-y-5 pt-3",
                                variant === "rail" && "h-full min-h-0 overflow-y-auto overscroll-contain pb-24 pr-1 app-scroll app-scroll-y app-scroll-gutter",
                                variant === "compact" && "max-h-[min(70dvh,28rem)] overflow-y-auto overscroll-contain pb-20 pr-1 app-scroll app-scroll-y app-scroll-gutter",
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
